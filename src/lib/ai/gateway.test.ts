import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AiGenerateRequest } from "@/lib/ai/contracts";
import { buildAnthropicRequest, buildVercelGatewayRequest } from "@/lib/ai/gateway";

const baseRequest: AiGenerateRequest = {
  route: { provider: "anthropic", model: "claude-sonnet-5" },
  system: "System instructions",
  messages: [{ role: "user", content: "Race data" }],
  maxOutputTokens: 4000,
  reasoning: { mode: "off" },
};

describe("AI gateway request normalization", () => {
  it("maps provider-neutral requests to Anthropic without changing current behavior", () => {
    const request = buildAnthropicRequest(baseRequest);

    expect(request.model).toBe("claude-sonnet-5");
    expect(request.max_tokens).toBe(4000);
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.system).toBe("System instructions");
  });

  it("preserves the always-thinking Claude exception in the Anthropic adapter", () => {
    const request = buildAnthropicRequest({
      ...baseRequest,
      route: { provider: "anthropic", model: "claude-fable-5" },
    });

    expect(Object.hasOwn(request, "thinking")).toBe(false);
  });

  it("maps a legacy bare Claude id to Vercel's canonical catalog namespace", () => {
    const request = buildVercelGatewayRequest({
      ...baseRequest,
      route: { provider: "vercel", model: "claude-sonnet-4-6" },
    });

    expect(request.model).toBe("anthropic/claude-sonnet-4.6");
    expect(request.max_completion_tokens).toBe(4000);
    expect(Object.hasOwn(request, "reasoning")).toBe(false);
    expect(request.providerOptions.gateway).toMatchObject({ sort: "cost" });
  });

  it("maps structured output for the Vercel AI Gateway", () => {
    const request = buildVercelGatewayRequest({
      ...baseRequest,
      route: { provider: "vercel", model: "openai/gpt-5-mini" },
      output: {
        type: "json_schema",
        name: "wind_quality",
        schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
    });

    expect(request.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "wind_quality", strict: true },
    });
  });

  it("maps adaptive reasoning effort across gateways", () => {
    const request = buildVercelGatewayRequest({
      ...baseRequest,
      route: { provider: "vercel", model: "anthropic/claude-sonnet-5" },
      reasoning: { mode: "adaptive", effort: "high" },
    });

    expect(request.reasoning).toEqual({ effort: "high" });
  });

  it("tags gateway spend by application feature", () => {
    const request = buildVercelGatewayRequest({
      ...baseRequest,
      route: { provider: "vercel", model: "anthropic/claude-sonnet-5" },
      feature: "dossier",
    });

    expect(request.providerOptions.gateway.tags).toEqual([
      "app:sailing",
      "feature:dossier",
    ]);
  });

  it("keeps Anthropic reasoning effort alongside structured output", () => {
    const request = buildAnthropicRequest({
      ...baseRequest,
      reasoning: { mode: "adaptive", effort: "high" },
      output: {
        type: "json_schema",
        name: "wind_quality",
        schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
    });

    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config).toMatchObject({
      effort: "high",
      format: { type: "json_schema" },
    });
  });
});
