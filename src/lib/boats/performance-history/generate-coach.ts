import "server-only";

import { generateAi } from "@/lib/ai/gateway";
import { getDossierAiConfig } from "@/lib/ai/settings";
import {
  PERFORMANCE_HISTORY_COACH_SYSTEM_PROMPT,
  buildPerformanceHistoryCoachCreateParams,
  validatePerformanceHistoryCoachMarkdown,
} from "@/lib/boats/performance-history/coach-request";
import type { CitedPerformanceHistoryHandoffV1 } from "@/lib/boats/performance-history/types";

export interface GeneratedPerformanceHistoryCoachNotes {
  markdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Optional Coach generation from a cited compact handoff only.
 * Never accepts raw tracks or uncited free-form claims.
 */
export async function generatePerformanceHistoryCoachNotes(
  handoff: CitedPerformanceHistoryHandoffV1,
): Promise<GeneratedPerformanceHistoryCoachNotes> {
  const dossierConfig = await getDossierAiConfig();
  const config = {
    ...dossierConfig,
    systemPrompt: PERFORMANCE_HISTORY_COACH_SYSTEM_PROMPT,
    maxTokens: Math.min(dossierConfig.maxTokens, 8_000),
  };

  const response = await generateAi(
    buildPerformanceHistoryCoachCreateParams(config, handoff),
  );

  if (response.finishReason === "max_tokens" || response.finishReason === "length") {
    throw new Error(
      "The AI provider reached the output-token limit before finishing coach notes.",
    );
  }

  const markdown = response.text;
  if (!validatePerformanceHistoryCoachMarkdown(markdown)) {
    throw new Error("The AI provider returned incomplete Performance History coach notes.");
  }

  return {
    markdown,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
