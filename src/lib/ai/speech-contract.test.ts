import { describe, expect, it } from "vitest";

import {
  isReplaySpeechVoice,
  normalizeReplaySpeechText,
  parseReplaySpeechRequest,
  REPLAY_SPEECH_DEFAULT_VOICE,
  REPLAY_SPEECH_MAX_CHARS,
} from "@/lib/ai/speech-contract";

describe("replay speech contract", () => {
  it("accepts known OpenAI TTS voices", () => {
    expect(isReplaySpeechVoice("onyx")).toBe(true);
    expect(isReplaySpeechVoice("alloy")).toBe(true);
    expect(isReplaySpeechVoice("robot")).toBe(false);
    expect(isReplaySpeechVoice(1)).toBe(false);
  });

  it("normalizes commentary whitespace", () => {
    expect(normalizeReplaySpeechText("  Boat One\ntakes  the lead  ")).toBe(
      "Boat One takes the lead",
    );
  });

  it("parses speech requests with a default voice", () => {
    expect(parseReplaySpeechRequest({ itemId: "event:first" })).toEqual({
      itemId: "event:first",
      voice: REPLAY_SPEECH_DEFAULT_VOICE,
    });
    expect(parseReplaySpeechRequest({ itemId: "event:first", voice: "nova" }))
      .toEqual({ itemId: "event:first", voice: "nova" });
    expect(parseReplaySpeechRequest({ itemId: "" })).toEqual({
      error: "itemId is required.",
    });
    expect(parseReplaySpeechRequest({ itemId: "x", voice: "robot" })).toEqual({
      error: "Unsupported voice.",
    });
  });

  it("exposes a short character budget for play-by-play lines", () => {
    expect(REPLAY_SPEECH_MAX_CHARS).toBeGreaterThan(80);
    expect(REPLAY_SPEECH_MAX_CHARS).toBeLessThanOrEqual(500);
  });
});
