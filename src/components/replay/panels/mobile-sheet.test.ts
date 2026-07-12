import { describe, expect, it } from "vitest";

import {
  resolveMobileSheetGesture,
  settleMobileSheet,
} from "@/components/replay/panels/mobile-sheet";

describe("settleMobileSheet", () => {
  it("opens after an upward swipe and closes after a downward swipe", () => {
    expect(settleMobileSheet({ open: false, deltaY: -60, durationMs: 300 })).toBe(true);
    expect(settleMobileSheet({ open: true, deltaY: 60, durationMs: 300 })).toBe(false);
  });

  it("accepts a short, deliberate fling", () => {
    expect(settleMobileSheet({ open: false, deltaY: -20, durationMs: 30 })).toBe(true);
    expect(settleMobileSheet({ open: true, deltaY: 20, durationMs: 30 })).toBe(false);
  });

  it("returns to the current state after a small or slow drag", () => {
    expect(settleMobileSheet({ open: false, deltaY: -10, durationMs: 400 })).toBe(false);
    expect(settleMobileSheet({ open: true, deltaY: 30, durationMs: 400 })).toBe(true);
  });
});

describe("resolveMobileSheetGesture", () => {
  it("treats a tap with slight movement as a toggle", () => {
    expect(resolveMobileSheetGesture({ open: false, deltaY: 8, durationMs: 120 })).toBe(true);
    expect(resolveMobileSheetGesture({ open: true, deltaY: -8, durationMs: 120 })).toBe(false);
  });

  it("settles a real drag without a follow-up toggle", () => {
    expect(resolveMobileSheetGesture({ open: false, deltaY: -60, durationMs: 300 })).toBe(true);
    expect(resolveMobileSheetGesture({ open: true, deltaY: 30, durationMs: 400 })).toBe(true);
  });
});
