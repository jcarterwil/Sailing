import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd());

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("video phase 4 replay integration invariants", () => {
  it("loads only ready videos on the authenticated replay page", () => {
    const page = read("src/app/races/[raceId]/replay/page.tsx");
    expect(page).toContain('.eq("status", "ready")');
    expect(page).toContain("VIDEO_READ_URL_TTL_SECONDS");
    expect(page).toContain("videoMetas");
    expect(page).toContain("createSignedUrl");
    expect(page).toContain("Promise.all");
  });

  it("keeps public share replay free of race_videos loading", () => {
    const share = read("src/app/s/[slug]/page.tsx");
    expect(share).not.toMatch(/race_videos/);
    expect(share).not.toMatch(/videoMetas/);
  });

  it("syncs from usePlaybackStore without a second rAF loop or store video fields", () => {
    const overlay = read("src/components/replay/video-overlay.tsx");
    const store = read("src/components/replay/playback-store.ts");
    const raceReplay = read("src/components/replay/race-replay.tsx");

    expect(overlay).toContain("usePlaybackStore.subscribe");
    expect(overlay).toContain("planVideoSync");
    expect(overlay).toContain("muted");
    expect(overlay).toContain("playsInline");
    expect(overlay).not.toMatch(/requestAnimationFrame/);

    expect(store).not.toMatch(/video/i);
    expect(raceReplay).toContain("<VideoOverlay");
    expect(raceReplay).toContain("!readOnly && videoMetas.length > 0");
  });

  it("recovers expired signed URLs through the authorized read action", () => {
    const overlay = read("src/components/replay/video-overlay.tsx");
    expect(overlay).toContain("requestVideoReadUrl");
    expect(overlay).toContain("MAX_ERROR_URL_REFRESHES");
    expect(overlay).toContain("{ once: true }");
    expect(overlay).toContain('className={minimized ? "hidden"');
  });
});
