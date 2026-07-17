export type AiProvider = "anthropic" | "vercel";

export const AI_FUNCTIONS = [
  "dossier",
  "performance_coach",
  "wind_explanation",
  "weather_interpretation",
] as const;

export type AiFunction = (typeof AI_FUNCTIONS)[number];

export type AiReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface AiRoute {
  provider: AiProvider;
  model: string;
}

export interface AiFunctionRoute extends AiRoute {
  function: AiFunction;
  maxOutputTokens: number;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiJsonOutput {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
}

export interface AiGenerateRequest {
  route: AiRoute;
  feature?: AiFunction;
  system?: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  reasoning?: {
    mode: "off" | "adaptive";
    effort?: AiReasoningEffort | null;
  };
  output?: AiJsonOutput;
}

export interface AiGenerateResult {
  text: string;
  model: string;
  provider: AiProvider;
  upstreamProvider: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  finishReason: string | null;
  generationId: string | null;
}

export interface AiCatalogModel {
  id: string;
  displayName: string;
  createdAt: string;
  contextWindow: number | null;
  structuredOutputs: boolean | null;
}
