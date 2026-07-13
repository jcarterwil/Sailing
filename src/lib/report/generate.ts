import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getDossierAiConfig } from "@/lib/ai/settings";
import { buildDossierCreateParams } from "@/lib/report/dossier-request";
import type { DossierStats } from "@/lib/report/dossier-stats";

export interface GeneratedDossier {
  markdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function dossierMarkdown(content: Anthropic.Message["content"]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

function validateDossier(markdown: string) {
  const requiredHeadings = [
    /^# Race Dossier\s*$/im,
    /^## Part 1\b/im,
    /^## Part 2\b/im,
    /^## Per-Boat Conclusions\s*$/im,
    /^## Provenance Appendix\s*$/im,
  ];
  if (!markdown || requiredHeadings.some((heading) => !heading.test(markdown))) {
    throw new Error("Anthropic returned an incomplete Race Dossier.");
  }
}

export async function generateDossier(
  statsPayload: DossierStats,
): Promise<GeneratedDossier> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const config = await getDossierAiConfig();
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create(
    buildDossierCreateParams(config, statsPayload),
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error("Anthropic reached the output-token limit before finishing the dossier.");
  }
  const markdown = dossierMarkdown(response.content);
  validateDossier(markdown);

  return {
    markdown,
    model: config.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
