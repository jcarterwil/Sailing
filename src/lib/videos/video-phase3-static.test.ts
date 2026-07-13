import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/videos/[videoId]/process/route.ts"),
  "utf8",
);
const actions = readFileSync(resolve(process.cwd(), "src/app/races/video-actions.ts"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260713170000_video_timing_phase3.sql"),
  "utf8",
);

describe("video phase 3 security and lifecycle boundaries", () => {
  it("authorizes via RLS-visible row before service-role processing", () => {
    expect(route).toContain("await supabase.auth.getUser()");
    expect(route).toContain('.from("race_videos")');
    expect(route).toContain('select("id, race_id, uploaded_by');
    expect(route.indexOf("createAdminClient()")).toBeGreaterThan(route.indexOf("canManageVideo"));
  });

  it("does not trust client-supplied path or race authorization", () => {
    expect(route).toContain("createVideoRangeReader(claimed.raw_path)");
    expect(route).not.toContain("request.json");
  });

  it("documents stale processing recovery and idempotency", () => {
    expect(route).toContain("STALE_PROCESSING_MS");
    expect(route).toContain('status: "ready", idempotent: true');
    expect(route).toContain('.eq("processing_attempts", visibleVideo.processing_attempts)');
    expect(route).toContain('.eq("processing_started_at", visibleVideo.processing_started_at!)');
    expect(route).toContain("if (!claimed)");
  });

  it("persists failures raised after an atomic claim", () => {
    expect(route.indexOf("try {")).toBeLessThan(
      route.indexOf("createVideoRangeReader(claimed.raw_path)"),
    );
    expect(route).toContain("sanitizeVideoProcessingError(error)");
    expect(route).toContain('status: "error"');
  });

  it("persists manual provenance through a server action", () => {
    expect(actions).toContain("validateManualVideoTiming");
    expect(actions).toContain("parseVideoUploadSummary(video.summary)?.confirmed");
    expect(actions).toContain('timing_provenance: "manual"');
    expect(actions).toContain('has_telemetry: false');
  });

  it("keeps schema additive and private", () => {
    expect(migration).toContain("add column if not exists timing_provenance");
    expect(migration).not.toMatch(/storage\.objects|\bto anon\b/i);
  });
});
