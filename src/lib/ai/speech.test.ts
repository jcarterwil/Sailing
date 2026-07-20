import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateReplaySpeech } from "@/lib/ai/speech";

describe("generateReplaySpeech", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the AI Gateway protocol version header required by /v4/ai", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ audio: Buffer.from("mp3").toString("base64") }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateReplaySpeech({
      text: "Boat One takes the lead.",
      voice: "onyx",
    });

    expect(result.contentType).toBe("audio/mpeg");
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ai-gateway.vercel.sh/v4/ai/speech-model");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-gateway-key");
    expect(headers.get("ai-model-id")).toBe("openai/tts-1");
    expect(headers.get("ai-gateway-protocol-version")).toBe("0.0.1");
    expect(headers.get("ai-gateway-auth-method")).toBe("api-key");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Boat One takes the lead.",
      voice: "onyx",
      outputFormat: "mp3",
    });
  });

  it("surfaces gateway protocol errors from the response body", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Unsupported gateway protocol version",
              type: "invalid_request_error",
              code: 400,
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      generateReplaySpeech({ text: "Rounding the windward mark." }),
    ).rejects.toThrow("Unsupported gateway protocol version");
  });
});
