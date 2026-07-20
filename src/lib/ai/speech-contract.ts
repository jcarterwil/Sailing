/**
 * Shared TTS contract for replay play-by-play voice (OpenAI via AI Gateway).
 * Keep this file free of server-only imports so the browser client can reuse it.
 */

export const REPLAY_SPEECH_MODEL = "openai/tts-1";
export const REPLAY_SPEECH_DEFAULT_VOICE = "onyx";
export const REPLAY_SPEECH_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export type ReplaySpeechVoice = (typeof REPLAY_SPEECH_VOICES)[number];

/** Play-by-play lines are short; reject long prompts to limit cost/abuse. */
export const REPLAY_SPEECH_MAX_CHARS = 400;

export function isReplaySpeechVoice(value: unknown): value is ReplaySpeechVoice {
  return (
    typeof value === "string" &&
    (REPLAY_SPEECH_VOICES as readonly string[]).includes(value)
  );
}

export function normalizeReplaySpeechText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseReplaySpeechRequest(body: unknown): {
  itemId: string;
  voice: ReplaySpeechVoice;
} | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid JSON body." };
  }
  const record = body as Record<string, unknown>;
  const itemId = typeof record.itemId === "string" ? record.itemId.trim() : "";
  if (!itemId || itemId.length > 200) {
    return { error: "itemId is required." };
  }
  if (record.voice === undefined || record.voice === null) {
    return { itemId, voice: REPLAY_SPEECH_DEFAULT_VOICE };
  }
  if (!isReplaySpeechVoice(record.voice)) {
    return { error: "Unsupported voice." };
  }
  return { itemId, voice: record.voice };
}
