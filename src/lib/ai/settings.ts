import "server-only";

import type { AiCatalogModel, AiProvider, AiRoute } from "@/lib/ai/contracts";
import { generateAi, listAiModels } from "@/lib/ai/gateway";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_DOSSIER_MAX_TOKENS,
  DEFAULT_DOSSIER_THINKING,
  DOSSIER_SYSTEM_PROMPT,
  type DossierAiConfig,
  type DossierEffort,
  type DossierThinkingMode,
} from "@/lib/report/dossier-request";
import type { WeatherEvidence } from "@/lib/weather/open-meteo";

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";
export const DEFAULT_AI_PROVIDER: AiProvider = "anthropic";

export type AiModelOption = AiCatalogModel;

export interface AiWeatherInterpretation {
  notes: string;
  seaState: string | null;
  seaStateBasis: string;
  model: string | null;
  warning: string | null;
}

function normalizeProvider(value: string | null | undefined): AiProvider {
  return value === "vercel" ? "vercel" : DEFAULT_AI_PROVIDER;
}

export async function getConfiguredAiRoute(): Promise<AiRoute> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_settings")
    .select("provider, model")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`Could not read AI settings: ${error.message}`);
  return {
    provider: normalizeProvider(data?.provider),
    model: data?.model || DEFAULT_AI_MODEL,
  };
}

export async function getConfiguredAiModel(): Promise<string> {
  return (await getConfiguredAiRoute()).model;
}

const VALID_DOSSIER_EFFORTS: readonly DossierEffort[] = ["low", "medium", "high", "xhigh", "max"];

export async function getDossierAiConfig(): Promise<DossierAiConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_settings")
    .select("provider, model, report_system_prompt, report_max_tokens, report_thinking, report_effort")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`Could not read AI settings: ${error.message}`);

  const model = data?.model || DEFAULT_AI_MODEL;
  const systemPrompt = data?.report_system_prompt?.trim() || DOSSIER_SYSTEM_PROMPT;
  const maxTokens =
    typeof data?.report_max_tokens === "number" && data.report_max_tokens > 0
      ? data.report_max_tokens
      : DEFAULT_DOSSIER_MAX_TOKENS;
  const thinking: DossierThinkingMode =
    data?.report_thinking === "adaptive" ? "adaptive" : DEFAULT_DOSSIER_THINKING;
  const effort =
    thinking === "adaptive" &&
    data?.report_effort &&
    (VALID_DOSSIER_EFFORTS as readonly string[]).includes(data.report_effort)
      ? (data.report_effort as DossierEffort)
      : null;

  return {
    provider: normalizeProvider(data?.provider),
    model,
    systemPrompt,
    maxTokens,
    thinking,
    effort,
  };
}

export async function listAvailableAiModels(): Promise<{
  models: AiModelOption[];
  warning: string | null;
}> {
  let route: AiRoute;
  try {
    route = await getConfiguredAiRoute();
  } catch (error) {
    return {
      models: [],
      warning:
        error instanceof Error
          ? `Could not read AI routing settings: ${error.message}`
          : "Could not read AI routing settings.",
    };
  }
  try {
    return {
      models: await listAiModels(route.provider),
      warning: null,
    };
  } catch (error) {
    return {
      models: [],
      warning:
        error instanceof Error
          ? `Could not load ${route.provider} models: ${error.message}`
          : `Could not load ${route.provider} models.`,
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
  let route: AiRoute;
  try {
    route = await getConfiguredAiRoute();
  } catch (error) {
    return deterministicInterpretation(
      evidence,
      error instanceof Error
        ? `AI configuration was unavailable (${error.message}); weather fields still come from Open-Meteo.`
        : "AI configuration was unavailable; weather fields still come from Open-Meteo.",
    );
  }

  try {
    const response = await generateAi({
      route,
      maxOutputTokens: 350,
      reasoning: { mode: "off" },
      system:
        "You summarize structured weather evidence for a sailboat race. Never call model output a direct observation. Do not change numeric values. Use concise plain English. Only classify sea state when marine wave-height evidence is present; otherwise return null.",
      messages: [
        {
          role: "user",
          content: `Create race-condition notes from this weather-service evidence:\n${JSON.stringify(evidence)}`,
        },
      ],
      output: {
        type: "json_schema",
        name: "race_weather_interpretation",
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
    });
    const parsed = validateInterpretation(JSON.parse(response.text));
    return { ...parsed, model: response.model, warning: null };
  } catch (error) {
    return deterministicInterpretation(
      evidence,
      error instanceof Error
        ? `AI summary failed (${error.message}); weather fields still come from Open-Meteo.`
        : "AI summary failed; weather fields still come from Open-Meteo.",
    );
  }
}
