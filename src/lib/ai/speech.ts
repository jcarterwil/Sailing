import "server-only";

import {
  clipReplaySpeechText,
  REPLAY_SPEECH_MODEL,
  REPLAY_SPEECH_DEFAULT_VOICE,
  type ReplaySpeechVoice,
} from "@/lib/ai/speech-contract";

export {
  clipReplaySpeechText,
  isReplaySpeechVoice,
  normalizeReplaySpeechText,
  parseReplaySpeechRequest,
  REPLAY_SPEECH_DEFAULT_VOICE,
  REPLAY_SPEECH_MAX_CHARS,
  REPLAY_SPEECH_MODEL,
  REPLAY_SPEECH_VOICES,
  type ReplaySpeechVoice,
} from "@/lib/ai/speech-contract";

/**
 * OpenAI text-to-speech via Vercel AI Gateway (REST).
 * https://vercel.com/docs/ai-gateway/modalities/text-to-speech
 *
 * The /v4/ai speech endpoint requires the same protocol header the AI SDK
 * sends (`ai-gateway-protocol-version`). Omitting it returns
 * "Unsupported gateway protocol version".
 */

const VERCEL_AI_GATEWAY_SPEECH_URL =
  "https://ai-gateway.vercel.sh/v4/ai/speech-model";

/** Matches `@ai-sdk/gateway` `AI_GATEWAY_PROTOCOL_VERSION`. */
const AI_GATEWAY_PROTOCOL_VERSION = "0.0.1";

type GatewaySpeechResponse = {
  audio?: string;
  warnings?: unknown[];
  error?: { message?: string; code?: string | number };
};

function speechAuth(): { token: string; authMethod: "api-key" | "oidc" } {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) {
    return { token: apiKey, authMethod: "api-key" };
  }
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  if (oidc) {
    return { token: oidc, authMethod: "oidc" };
  }
  throw new Error("AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is not configured.");
}

export async function generateReplaySpeech(options: {
  text: string;
  voice?: ReplaySpeechVoice;
  signal?: AbortSignal;
}): Promise<{ audio: Uint8Array; contentType: "audio/mpeg" }> {
  const text = clipReplaySpeechText(options.text);
  if (!text) throw new Error("Speech text is empty.");

  const voice = options.voice ?? REPLAY_SPEECH_DEFAULT_VOICE;
  const auth = speechAuth();
  const response = await fetch(VERCEL_AI_GATEWAY_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
      "ai-model-id": REPLAY_SPEECH_MODEL,
      "ai-gateway-protocol-version": AI_GATEWAY_PROTOCOL_VERSION,
      "ai-gateway-auth-method": auth.authMethod,
    },
    body: JSON.stringify({
      text,
      voice,
      outputFormat: "mp3",
    }),
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });

  const payload = (await response.json()) as GatewaySpeechResponse;
  if (!response.ok || payload.error || typeof payload.audio !== "string") {
    const detail =
      payload.error?.message ??
      (typeof payload.audio === "string" ? `HTTP ${response.status}` : "missing audio");
    throw new Error(`Vercel AI Gateway speech failed: ${detail}`);
  }

  const audio = Uint8Array.from(Buffer.from(payload.audio, "base64"));
  if (audio.byteLength === 0) {
    throw new Error("Vercel AI Gateway speech returned empty audio.");
  }
  return { audio, contentType: "audio/mpeg" };
}
