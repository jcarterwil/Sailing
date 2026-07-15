import { describe, expect, it } from "vitest";

import type { BroadcastRendererFailure } from "@/components/replay/broadcast-3d-renderer";
import { runBroadcastRendererActionSafely } from "@/components/replay/broadcast-runtime-boundary";

describe("Broadcast renderer runtime boundary", () => {
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
