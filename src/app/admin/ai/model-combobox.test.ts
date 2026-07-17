import { describe, expect, it } from "vitest";

import { filterModelOptions } from "@/app/admin/ai/model-combobox";
import type { AiModelOption } from "@/lib/ai/settings";

const models: AiModelOption[] = [
  { id: "anthropic/claude-sonnet-5", displayName: "Claude Sonnet 5", createdAt: "", contextWindow: null, structuredOutputs: null },
  { id: "anthropic/claude-haiku-4.5", displayName: "Claude Haiku 4.5", createdAt: "", contextWindow: null, structuredOutputs: null },
  { id: "openai/gpt-5.4", displayName: "GPT-5.4", createdAt: "", contextWindow: null, structuredOutputs: null },
];

describe("filterModelOptions", () => {
  it("returns every option (up to the cap) for an empty query", () => {
    expect(filterModelOptions(models, "")).toHaveLength(3);
    expect(filterModelOptions(models, "   ")).toHaveLength(3);
  });

  it("matches on slug and display name, case-insensitively", () => {
    expect(filterModelOptions(models, "SONNET").map((m) => m.id)).toEqual(["anthropic/claude-sonnet-5"]);
    expect(filterModelOptions(models, "gpt").map((m) => m.id)).toEqual(["openai/gpt-5.4"]);
    // Display name "Claude Haiku 4.5" matches even though the slug has no space.
    expect(filterModelOptions(models, "haiku 4").map((m) => m.id)).toEqual(["anthropic/claude-haiku-4.5"]);
  });

  it("matches every provider's models on a shared substring", () => {
    expect(filterModelOptions(models, "claude").map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-haiku-4.5",
    ]);
  });

  it("returns nothing when no option matches", () => {
    expect(filterModelOptions(models, "gemini")).toEqual([]);
  });

  it("caps the result count so a 200-model catalog stays responsive", () => {
    const many: AiModelOption[] = Array.from({ length: 300 }, (_, i) => ({
      id: `p/model-${i}`,
      displayName: `Model ${i}`,
      createdAt: "",
      contextWindow: null,
      structuredOutputs: null,
    }));
    expect(filterModelOptions(many, "")).toHaveLength(100);
  });
});
