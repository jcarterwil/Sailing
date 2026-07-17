import "server-only";

import { generateAi } from "@/lib/ai/gateway";
import { getDossierAiConfig } from "@/lib/ai/settings";
import { buildDossierAiRequest } from "@/lib/report/dossier-request";
import type { DossierStats } from "@/lib/report/dossier-stats";

export interface GeneratedDossier {
  markdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
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
    throw new Error("The AI provider returned an incomplete Race Dossier.");
  }
}

export async function generateDossier(
  statsPayload: DossierStats,
): Promise<GeneratedDossier> {
  const config = await getDossierAiConfig();
  const response = await generateAi(buildDossierAiRequest(config, statsPayload));

  if (response.finishReason === "max_tokens" || response.finishReason === "length") {
    throw new Error("The AI provider reached the output-token limit before finishing the dossier.");
  }
  const markdown = response.text;
  validateDossier(markdown);

  return {
    markdown,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
