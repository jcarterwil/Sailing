import type { RaceTimerEvent } from "@/lib/analytics/types";
import type { SessionTypeSuggestion } from "@/lib/imports/types";

export function suggestSessionType(input: {
  timerEvents: RaceTimerEvent[] | null | undefined;
  timerEventCount: number;
  linePingCount: number;
}): SessionTypeSuggestion {
  const events = input.timerEvents ?? [];
  const hasRaceStart = events.some((event) => event.event === "race_start");
  const hasTimerEvidence = input.timerEventCount > 0 || events.length > 0;
  const hasStartLine = input.linePingCount > 0;

  if (hasRaceStart) {
    return {
      sessionType: "race",
      confidence: "high",
      reason: "File contains a race_start timer event.",
    };
  }
  if (hasTimerEvidence && hasStartLine) {
    return {
      sessionType: "race",
      confidence: "medium",
      reason: "File contains both timer evidence and start-line pings.",
    };
  }
  return {
    sessionType: "practice",
    confidence: hasTimerEvidence || hasStartLine ? "medium" : "low",
    reason: "No race timer (or timer+start-line pair); defaulting to Practice.",
  };
}
