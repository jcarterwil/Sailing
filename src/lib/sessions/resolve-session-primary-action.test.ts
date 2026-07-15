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
  hasMissingTrack: false,
  hasProcessingTrack: false,
  hasErrorTrack: false,
  allTracksProcessed: false,
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

  it("sends incomplete fleets back to Data before review", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        hasMissingTrack: true,
        replayAvailable: true,
      }),
    ).toEqual({
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
        allTracksProcessed: false,
      }),
    ).toEqual({
      kind: "processing",
      label: "Processing…",
      href: null,
      disabled: true,
    });
  });

  it("offers Fix data issue for uploaders when a track failed", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        canEdit: false,
        canUpload: true,
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

  it("offers Review & analyze only when the full fleet is processed", () => {
    expect(
      resolveSessionPrimaryAction({
        ...base,
        hasAnyTrack: true,
        allTracksProcessed: true,
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
        allTracksProcessed: true,
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
        allTracksProcessed: true,
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
        allTracksProcessed: true,
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
  it("aggregates track flags and requires processed_path for replay", () => {
    expect(
      summarizeSessionTrackStatuses([
        null,
        { status: "processing" },
        { status: "error" },
        { status: "processed", processedPath: "tracks/a.json" },
      ]),
    ).toEqual({
      hasAnyTrack: true,
      hasMissingTrack: true,
      hasProcessingTrack: true,
      hasErrorTrack: true,
      allTracksProcessed: false,
      replayAvailable: true,
    });
    expect(
      summarizeSessionTrackStatuses([{ status: "processed", processedPath: null }]),
    ).toEqual({
      hasAnyTrack: true,
      hasMissingTrack: false,
      hasProcessingTrack: false,
      hasErrorTrack: false,
      allTracksProcessed: true,
      replayAvailable: false,
    });
    expect(summarizeSessionTrackStatuses([null, null])).toEqual({
      hasAnyTrack: false,
      hasMissingTrack: true,
      hasProcessingTrack: false,
      hasErrorTrack: false,
      allTracksProcessed: false,
      replayAvailable: false,
    });
  });
});
