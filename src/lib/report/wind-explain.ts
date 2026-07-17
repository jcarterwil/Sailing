import "server-only";

import type { AiFunctionRoute } from "@/lib/ai/contracts";
import { generateAi } from "@/lib/ai/gateway";
import { getAiFunctionRoute } from "@/lib/ai/settings";
import type { WindQualityReport } from "@/lib/analytics/types";
import {
  deterministicWindExplanations,
  type WindExplainItem,
} from "@/lib/report/wind-explain-text";

export type { WindExplainItem };
export { deterministicWindExplanations };

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
 * Gracefully falls back when the configured provider / config is absent.
 * Feed only WindQualityReport JSON — never raw tracks.
 */
export async function explainWindQuality(
  report: WindQualityReport,
): Promise<{ items: WindExplainItem[]; model: string | null; fallback: boolean }> {
  const fallback = deterministicWindExplanations(report);
  if (report.boats.length === 0) {
    return { items: fallback, model: null, fallback: true };
  }

  let route: AiFunctionRoute;
  try {
    route = await getAiFunctionRoute("wind_explanation");
  } catch {
    return { items: fallback, model: null, fallback: true };
  }

  try {
    const response = await generateAi({
      route,
      feature: "wind_explanation",
      maxOutputTokens: route.maxOutputTokens,
      reasoning: { mode: "off" },
      system:
        "You explain sailboat race wind-sensor quality findings for an organizer. Use concise plain English. Do not invent numbers. Do not recommend excluding boats from fleet stats — only wind-sensor caveats. One short sentence per boat.",
      messages: [
        {
          role: "user",
          content: `Explain these per-boat wind quality findings for a race organizer:\n${JSON.stringify(report)}`,
        },
      ],
      output: {
        type: "json_schema",
        name: "race_wind_quality_explanations",
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
    });
    return {
      items: validateExplanations(JSON.parse(response.text), report),
      model: response.model,
      fallback: false,
    };
  } catch {
    return { items: fallback, model: null, fallback: true };
  }
}
