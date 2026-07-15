import { describe, expect, it } from "vitest";

import {
  resolveSessionPrimaryAction,
  summarizeSessionTrackStatuses,
  type ResolveSessionPrimaryActionInput,
} from "@/lib/sessions/resolve-session-primary-action";

const base: ResolveSessionPrimaryActionInput = {
  raceId: "00000000-0000-4000-8000-000000000001",
  sessionType: "race",
  canUpload: true,
  canEdit: true,
  hasAnyTrack: false,
  hasProcessingTrack: false,
  hasErrorTrack: false,
  analysisCurrent: false,
  replayAvailable: false,
};

describe("resolveSessionPrimaryAction", () => {
  it("prioritizes Add data when there is no track and the caller can upload", () => {
    expect(resolveSessionPrimaryAction(base)).toEqual({
      kind: "add-data",
      label: "Add data",
      href: `/races/${base.raceId}?tab=data`,
      disabled: false,
    });
  });

  it("returns null for viewers with no track", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        canUpload: false,
        canEdit: false,
      }),
    ).toBeNull();
  });

  it("shows non-clickable Processing… while tracks process", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        hasProcessingTrack: true,
      }),
    ).toEqual({
      kind: "processing",
      label: "Processing…",
      href: null,
      disabled: true,
    });
  });

  it("offers Fix data issue for editors when a track failed", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        hasErrorTrack: true,
      }),
    ).toEqual({
      kind: "fix-data",
      label: "Fix data issue",
      href: `/races/${base.raceId}?tab=data`,
      disabled: false,
    });
  });

  it("does not offer Fix data issue to read-only users", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        canUpload: false,
        canEdit: false,
        hasAnyTrack: true,
        hasErrorTrack: true,
      }),
    ).toBeNull();
  });

  it("offers Review & analyze when analysis is missing or stale", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        replayAvailable: true,
        analysisCurrent: false,
      }),
    ).toEqual({
      kind: "review-analyze",
      label: "Review & analyze",
      href: `/races/${base.raceId}/review`,
      disabled: false,
    });
  });

  it("routes practice Review & analyze to the Data tab", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        sessionType: "practice",
        hasAnyTrack: true,
        replayAvailable: true,
        analysisCurrent: false,
      })?.href,
    ).toBe(`/races/${base.raceId}?tab=data`);
  });

  it("offers Open replay when analysis is current", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        replayAvailable: true,
        analysisCurrent: true,
      }),
    ).toEqual({
      kind: "open-replay",
      label: "Open replay",
      href: `/races/${base.raceId}/replay`,
      disabled: false,
    });
  });

  it("never invents edit CTAs for viewers when analysis is stale", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        canUpload: false,
        canEdit: false,
        hasAnyTrack: true,
        replayAvailable: true,
        analysisCurrent: false,
      }),
    ).toBeNull();
  });

  it("prefers processing over error and review actions", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        hasProcessingTrack: true,
        hasErrorTrack: true,
        analysisCurrent: false,
      })?.kind,
    ).toBe("processing");
  });
});

describe("summarizeSessionTrackStatuses", () => {
  it("aggregates track flags for the resolver", () => {
    expect(summarizeSessionTrackStatuses([null, "processing", "error", "processed"])).toEqual({
      hasAnyTrack: true,
      hasProcessingTrack: true,
      hasErrorTrack: true,
      replayAvailable: true,
    });
    expect(summarizeSessionTrackStatuses([null, null])).toEqual({
      hasAnyTrack: false,
      hasProcessingTrack: false,
      hasErrorTrack: false,
      replayAvailable: false,
    });
  });
});
