import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type {
  AiCatalogModel,
  AiGenerateRequest,
  AiGenerateResult,
  AiJsonOutput,
  AiProvider,
  AiReasoningEffort,
} from "@/lib/ai/contracts";

const VERCEL_AI_GATEWAY_API_BASE = "https://ai-gateway.vercel.sh/v1";

type VercelGatewayUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

type VercelGatewayCompletion = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | Array<{ type?: string; text?: string }> | null };
  }>;
  usage?: VercelGatewayUsage;
  error?: { message?: string; code?: string | number };
  provider_metadata?: VercelGatewayMetadata;
  providerMetadata?: VercelGatewayMetadata;
};

type VercelGatewayMetadata = {
  gateway?: {
    cost?: string | number;
    generationId?: string;
    routing?: { finalProvider?: string };
  };
};

type VercelGatewayModel = {
  id: string;
  name?: string;
  created?: number;
  context_window?: number;
  max_tokens?: number;
  type?: string;
  tags?: string[];
};

type VercelGatewayContent =
  | string
  | Array<{ type?: string; text?: string }>
  | null
  | undefined;

function requiredApiKey(provider: AiProvider): string {
  const key =
    provider === "vercel"
      ? process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN
      : process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const name =
      provider === "vercel"
        ? "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN"
        : "ANTHROPIC_API_KEY";
    throw new Error(`${name} is not configured.`);
  }
  return key;
}

function anthropicModelId(model: string): string {
  return model.startsWith("anthropic/") ? model.slice("anthropic/".length) : model;
}

function vercelGatewayModelId(provider: AiProvider, model: string): string {
  if (model.includes("/")) return model;
  if (provider !== "vercel" || !model.startsWith("claude-")) return model;
  // Direct Anthropic historically used hyphenated version suffixes. Vercel's
  // canonical catalog uses dots (claude-sonnet-4.6).
  const canonical = model.replace(/-(\d+)-(\d+)$/, "-$1.$2");
  return `anthropic/${canonical}`;
}

function anthropicOutput(output: AiJsonOutput | undefined) {
  if (!output) return {};
  return {
    output_config: {
      format: {
        type: "json_schema" as const,
        schema: output.schema,
      },
    },
  };
}

function anthropicReasoning(
  model: string,
  reasoning: AiGenerateRequest["reasoning"],
) {
  if (!reasoning) return {};
  if (reasoning.mode === "adaptive") {
    const effort = reasoning.effort === "minimal" ? "low" : reasoning.effort;
    return {
      thinking: { type: "adaptive" as const },
      ...(effort ? { output_config: { effort } } : {}),
    };
  }
  // Fable/Mythos always think and reject an explicit disabled value.
  if (/^claude-(fable|mythos)/.test(anthropicModelId(model))) return {};
  return { thinking: { type: "disabled" as const } };
}

export function buildAnthropicRequest(
  request: AiGenerateRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  const reasoning = anthropicReasoning(request.route.model, request.reasoning);
  const output = anthropicOutput(request.output);
  return {
    model: anthropicModelId(request.route.model),
    max_tokens: request.maxOutputTokens,
    ...(request.system ? { system: request.system } : {}),
    messages: request.messages,
    ...reasoning,
    ...output,
    // Both features use output_config. Merge their children rather than letting
    // JSON-schema output erase configured reasoning effort (or vice versa).
    ...("output_config" in reasoning || "output_config" in output
      ? {
          output_config: {
            ...("output_config" in reasoning ? reasoning.output_config : {}),
            ...("output_config" in output ? output.output_config : {}),
          },
        }
      : {}),
  } as Anthropic.MessageCreateParamsNonStreaming;
}

function vercelGatewayReasoning(
  reasoning: AiGenerateRequest["reasoning"],
): { effort: AiReasoningEffort } | undefined {
  // Omit the generic field when off. Some gateway models require reasoning
  // and reject an explicit `none`; models that support provider-specific
  // disabling can still use the direct adapter.
  if (!reasoning || reasoning.mode === "off") return undefined;
  return { effort: reasoning.effort ?? "medium" };
}

export function buildVercelGatewayRequest(request: AiGenerateRequest) {
  const reasoning = vercelGatewayReasoning(request.reasoning);
  return {
    model: vercelGatewayModelId(request.route.provider, request.route.model),
    messages: [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      ...request.messages,
    ],
    max_completion_tokens: request.maxOutputTokens,
    ...(reasoning ? { reasoning } : {}),
    ...(request.output
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: request.output.name,
              strict: true,
              schema: request.output.schema,
            },
          },
        }
      : {}),
    providerOptions: {
      gateway: {
        sort: "cost" as const,
        tags: ["app:sailing", `feature:${request.feature ?? "unclassified"}`],
      },
    },
  };
}

function vercelGatewayText(content: VercelGatewayContent): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function generateWithAnthropic(request: AiGenerateRequest): Promise<AiGenerateResult> {
  const client = new Anthropic({ apiKey: requiredApiKey("anthropic") });
  const response = await client.messages.create(buildAnthropicRequest(request));
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
  if (!text) throw new Error("Anthropic returned no text content.");
  return {
    text,
    model: response.model,
    provider: "anthropic",
    upstreamProvider: "anthropic",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    costUsd: null,
    finishReason: response.stop_reason,
    generationId: response.id,
  };
}

async function generateWithVercelGateway(request: AiGenerateRequest): Promise<AiGenerateResult> {
  const response = await fetch(`${VERCEL_AI_GATEWAY_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredApiKey("vercel")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVercelGatewayRequest(request)),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const payload = (await response.json()) as VercelGatewayCompletion;
  if (!response.ok || payload.error) {
    const detail = payload.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Vercel AI Gateway request failed: ${detail}`);
  }
  const choice = payload.choices?.[0];
  const text = vercelGatewayText(choice?.message?.content);
  if (!text) throw new Error("Vercel AI Gateway returned no text content.");
  const inputTokens = payload.usage?.prompt_tokens ?? 0;
  const outputTokens = payload.usage?.completion_tokens ?? 0;
  const metadata = payload.provider_metadata ?? payload.providerMetadata;
  const rawCost = metadata?.gateway?.cost;
  const costUsd = typeof rawCost === "number" ? rawCost : Number.parseFloat(rawCost ?? "");
  return {
    text,
    model: payload.model ?? vercelGatewayModelId("vercel", request.route.model),
    provider: "vercel",
    upstreamProvider: metadata?.gateway?.routing?.finalProvider ?? null,
    inputTokens,
    outputTokens,
    totalTokens: payload.usage?.total_tokens ?? inputTokens + outputTokens,
    costUsd: Number.isFinite(costUsd) ? costUsd : payload.usage?.cost ?? null,
    finishReason: choice?.finish_reason ?? null,
    generationId: metadata?.gateway?.generationId ?? payload.id ?? null,
  };
}

export async function generateAi(request: AiGenerateRequest): Promise<AiGenerateResult> {
  return request.route.provider === "vercel"
    ? generateWithVercelGateway(request)
    : generateWithAnthropic(request);
}

export async function listAiModels(provider: AiProvider): Promise<AiCatalogModel[]> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: requiredApiKey("anthropic") });
    const page = await client.models.list({ limit: 100 });
    return page.data.map((model) => ({
      id: model.id,
      displayName: model.display_name,
      createdAt: model.created_at,
      contextWindow: null,
      structuredOutputs: model.capabilities?.structured_outputs?.supported ?? null,
    }));
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  const response = await fetch(`${VERCEL_AI_GATEWAY_API_BASE}/models`, {
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Vercel AI Gateway model discovery failed: HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: VercelGatewayModel[] };
  return (payload.data ?? [])
    .filter((model) => !model.type || model.type === "language")
    .map((model) => ({
      id: model.id,
      displayName: model.name ?? model.id,
      createdAt: model.created ? new Date(model.created * 1000).toISOString() : "",
      contextWindow: model.context_window ?? null,
      structuredOutputs: null,
    }));
}

export async function validateAiModel(
  provider: AiProvider,
  model: string,
): Promise<AiCatalogModel> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: requiredApiKey("anthropic") });
    const selected = await client.models.retrieve(anthropicModelId(model));
    return {
      id: selected.id,
      displayName: selected.display_name,
      createdAt: selected.created_at,
      contextWindow: null,
      structuredOutputs: selected.capabilities?.structured_outputs?.supported ?? null,
    };
  }
  const models = await listAiModels("vercel");
  const selected = models.find(
    (candidate) => candidate.id === vercelGatewayModelId(provider, model),
  );
  if (!selected) throw new Error("The model is not present in the Vercel AI Gateway catalog.");
  return selected;
}
