import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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

function textFromContent(content: Anthropic.Message["content"]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

/**
 * Optional Coach generation from a cited compact handoff only.
 * Never accepts raw tracks or uncited free-form claims.
 */
export async function generatePerformanceHistoryCoachNotes(
  handoff: CitedPerformanceHistoryHandoffV1,
): Promise<GeneratedPerformanceHistoryCoachNotes> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const dossierConfig = await getDossierAiConfig();
  const config = {
    ...dossierConfig,
    systemPrompt: PERFORMANCE_HISTORY_COACH_SYSTEM_PROMPT,
    maxTokens: Math.min(dossierConfig.maxTokens, 8_000),
  };

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create(
    buildPerformanceHistoryCoachCreateParams(config, handoff),
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Anthropic reached the output-token limit before finishing coach notes.",
    );
  }

  const markdown = textFromContent(response.content);
  if (!validatePerformanceHistoryCoachMarkdown(markdown)) {
    throw new Error("Anthropic returned incomplete Performance History coach notes.");
  }

  return {
    markdown,
    model: config.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
