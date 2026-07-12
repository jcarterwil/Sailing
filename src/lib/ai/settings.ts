import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { createAdminClient } from "@/lib/supabase/admin";
import type { WeatherEvidence } from "@/lib/weather/open-meteo";

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

export interface AiModelOption {
  id: string;
  displayName: string;
  createdAt: string;
  structuredOutputs: boolean | null;
}

export interface AiWeatherInterpretation {
  notes: string;
  seaState: string | null;
  seaStateBasis: string;
  model: string | null;
  warning: string | null;
}

export async function getConfiguredAiModel(): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_settings")
    .select("model")
    .eq("id", true)
    .maybeSingle();
  if (error || !data?.model) return DEFAULT_AI_MODEL;
  return data.model;
}

function anthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

export async function listAvailableAiModels(): Promise<{
  models: AiModelOption[];
  warning: string | null;
}> {
  const client = anthropicClient();
  if (!client) {
    return {
      models: [],
      warning: "ANTHROPIC_API_KEY is not configured, so live model discovery is unavailable.",
    };
  }
  try {
    const page = await client.models.list({ limit: 100 });
    return {
      models: page.data.map((model) => ({
        id: model.id,
        displayName: model.display_name,
        createdAt: model.created_at,
        structuredOutputs: model.capabilities?.structured_outputs?.supported ?? null,
      })),
      warning: null,
    };
  } catch (error) {
    return {
      models: [],
      warning: error instanceof Error ? `Could not load Anthropic models: ${error.message}` : "Could not load Anthropic models.",
    };
  }
}

function deterministicNotes(evidence: WeatherEvidence): string {
  const details = [
    `Open-Meteo 10 m wind ${evidence.windMinKts}–${evidence.windMaxKts} kt from ${evidence.windDirectionDeg}°`,
  ];
  if (evidence.gustMaxKts !== null) details.push(`gusting ${evidence.gustMaxKts} kt`);
  if (evidence.temperatureMinC !== null && evidence.temperatureMaxC !== null) {
    details.push(`temperature ${evidence.temperatureMinC}–${evidence.temperatureMaxC}°C`);
  }
  if (evidence.precipitationMm !== null) details.push(`${evidence.precipitationMm} mm precipitation`);
  if (evidence.cloudCoverPct !== null) details.push(`${evidence.cloudCoverPct}% cloud cover`);
  return `${details.join("; ")}. Model-derived weather; review against race-day observations.`;
}

function deterministicSeaState(evidence: WeatherEvidence): string | null {
  const height = evidence.waveHeightMaxM;
  if (height === null) return null;
  if (height < 0.1) return "Calm (model wave height under 0.1 m)";
  if (height < 0.5) return "Slight (model waves 0.1–0.5 m)";
  if (height < 1.25) return "Moderate (model waves 0.5–1.25 m)";
  if (height < 2.5) return "Rough (model waves 1.25–2.5 m)";
  return "Very rough (model waves above 2.5 m)";
}

function deterministicInterpretation(
  evidence: WeatherEvidence,
  warning: string,
): AiWeatherInterpretation {
  return {
    notes: deterministicNotes(evidence),
    seaState: deterministicSeaState(evidence),
    seaStateBasis: evidence.waveHeightMaxM === null
      ? "No marine wave data was available; sea state was left blank."
      : "Classified deterministically from Open-Meteo model wave height.",
    model: null,
    warning,
  };
}

function validateInterpretation(value: unknown): Pick<AiWeatherInterpretation, "notes" | "seaState" | "seaStateBasis"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI returned an invalid weather response.");
  }
  const record = value as Record<string, unknown>;
  const notes = typeof record.notes === "string" ? record.notes.trim() : "";
  const seaState = typeof record.seaState === "string" ? record.seaState.trim() || null : null;
  const seaStateBasis = typeof record.seaStateBasis === "string" ? record.seaStateBasis.trim() : "";
  if (!notes || notes.length > 800 || !seaStateBasis || seaStateBasis.length > 300) {
    throw new Error("AI returned incomplete weather fields.");
  }
  return { notes, seaState, seaStateBasis };
}

export async function interpretWeatherWithAi(
  evidence: WeatherEvidence,
): Promise<AiWeatherInterpretation> {
  const client = anthropicClient();
  if (!client) {
    return deterministicInterpretation(
      evidence,
      "AI was unavailable because ANTHROPIC_API_KEY is not configured; weather fields still come from Open-Meteo.",
    );
  }

  let model: string;
  try {
    model = await getConfiguredAiModel();
  } catch (error) {
    return deterministicInterpretation(
      evidence,
      error instanceof Error
        ? `AI configuration was unavailable (${error.message}); weather fields still come from Open-Meteo.`
        : "AI configuration was unavailable; weather fields still come from Open-Meteo.",
    );
  }

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 350,
      system:
        "You summarize structured weather evidence for a sailboat race. Never call model output a direct observation. Do not change numeric values. Use concise plain English. Only classify sea state when marine wave-height evidence is present; otherwise return null.",
      messages: [
        {
          role: "user",
          content: `Create race-condition notes from this weather-service evidence:\n${JSON.stringify(evidence)}`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              notes: { type: "string", maxLength: 800 },
              seaState: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
              seaStateBasis: { type: "string", maxLength: 300 },
            },
            required: ["notes", "seaState", "seaStateBasis"],
          },
        },
      },
    });
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error("AI returned no weather summary.");
    const parsed = validateInterpretation(JSON.parse(text.text));
    return { ...parsed, model, warning: null };
  } catch (error) {
    return deterministicInterpretation(
      evidence,
      error instanceof Error
        ? `AI summary failed (${error.message}); weather fields still come from Open-Meteo.`
        : "AI summary failed; weather fields still come from Open-Meteo.",
    );
  }
}
