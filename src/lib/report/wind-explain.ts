import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getConfiguredAiModel } from "@/lib/ai/settings";
import type { WindQualityReport } from "@/lib/analytics/types";
import {
  deterministicWindExplanations,
  type WindExplainItem,
} from "@/lib/report/wind-explain-text";

export type { WindExplainItem };
export { deterministicWindExplanations };

function anthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function validateExplanations(
  value: unknown,
  report: WindQualityReport,
): WindExplainItem[] {
  if (!value || typeof value !== "object") {
    throw new Error("AI returned a non-object wind explanation payload.");
  }
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error("AI returned no explanation items.");
  const byId = new Map<string, string>();
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const entryId = typeof record.entryId === "string" ? record.entryId : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!entryId || !text || text.length > 400) continue;
    byId.set(entryId, text);
  }
  return report.boats.map((boat) => ({
    entryId: boat.entryId,
    text:
      byId.get(boat.entryId) ??
      deterministicWindExplanations({
        boats: [boat],
        consensusTwdDeg: report.consensusTwdDeg,
        estimateTwdDeg: report.estimateTwdDeg,
      })[0]?.text ??
      "No explanation available.",
  }));
}

/**
 * Optional plain-English explanations for wind-quality findings.
 * Gracefully falls back when ANTHROPIC_API_KEY / config is absent.
 * Feed only WindQualityReport JSON — never raw tracks.
 */
export async function explainWindQuality(
  report: WindQualityReport,
): Promise<{ items: WindExplainItem[]; model: string | null; fallback: boolean }> {
  const fallback = deterministicWindExplanations(report);
  if (report.boats.length === 0) {
    return { items: fallback, model: null, fallback: true };
  }

  const client = anthropicClient();
  if (!client) {
    return { items: fallback, model: null, fallback: true };
  }

  let model: string;
  try {
    model = await getConfiguredAiModel();
  } catch {
    return { items: fallback, model: null, fallback: true };
  }

  // This extraction needs no reasoning. Sonnet 5 and peers run adaptive thinking
  // by default when `thinking` is omitted, which spends the max_tokens budget on
  // reasoning and starves the JSON answer (#52); disable it so the full budget
  // goes to the output. Fable 5 / Mythos 5 always think and reject an explicit
  // `{ type: "disabled" }` (400), so omit the field for them instead.
  const alwaysThinks = /^claude-(fable|mythos)/.test(model);
  const thinking = alwaysThinks ? null : ({ type: "disabled" } as const);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      ...(thinking ? { thinking } : {}),
      system:
        "You explain sailboat race wind-sensor quality findings for an organizer. Use concise plain English. Do not invent numbers. Do not recommend excluding boats from fleet stats — only wind-sensor caveats. One short sentence per boat.",
      messages: [
        {
          role: "user",
          content: `Explain these per-boat wind quality findings for a race organizer:\n${JSON.stringify(report)}`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    entryId: { type: "string" },
                    text: { type: "string", maxLength: 400 },
                  },
                  required: ["entryId", "text"],
                },
              },
            },
            required: ["items"],
          },
        },
      },
    });
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error("AI returned no wind explanation.");
    return {
      items: validateExplanations(JSON.parse(text.text), report),
      model,
      fallback: false,
    };
  } catch {
    return { items: fallback, model: null, fallback: true };
  }
}
