export type AiProvider = "anthropic" | "vercel";

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
