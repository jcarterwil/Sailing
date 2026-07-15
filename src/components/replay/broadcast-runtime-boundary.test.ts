import { describe, expect, it } from "vitest";

import type { BroadcastRendererFailure } from "@/components/replay/broadcast-3d-renderer";
import {
  broadcastFailureFromCause,
  runBroadcastRendererActionSafely,
} from "@/components/replay/broadcast-runtime-boundary";

describe("Broadcast renderer runtime boundary", () => {
  it("normalizes a lazy component-load failure for Tactical fallback", () => {
    const cause = new Error("Loading chunk 42 failed");

    expect(broadcastFailureFromCause(cause)).toEqual({
      code: "initialization-failed",
      message: "Loading chunk 42 failed",
      cause,
    });
    expect(broadcastFailureFromCause("offline")).toEqual({
      code: "initialization-failed",
      message: "Could not initialize Broadcast 3D.",
      cause: "offline",
    });
  });

  it("reports a throwing action without letting renderer or callback errors escape", () => {
    const rendererError = new Error("render exploded");
    const reported: BroadcastRendererFailure[] = [];
    let normalizedCause: unknown;
    let completed = true;

    expect(() => {
      completed = runBroadcastRendererActionSafely(
        () => {
          throw rendererError;
        },
        (cause) => {
          normalizedCause = cause;
          return {
            code: "context-lost",
            message: "Broadcast render failed.",
            cause,
          };
        },
        (failure) => {
          reported.push(failure);
          throw new Error("parent callback exploded");
        },
      );
    }).not.toThrow();

    expect(completed).toBe(false);
    expect(normalizedCause).toBe(rendererError);
    expect(reported).toEqual([
      {
        code: "context-lost",
        message: "Broadcast render failed.",
        cause: rendererError,
      },
    ]);
  });
});
