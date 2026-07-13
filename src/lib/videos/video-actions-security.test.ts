import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const actions = readFileSync(
  resolve(process.cwd(), "src/app/races/video-actions.ts"),
  "utf8",
);
const clientUpload = readFileSync(
  resolve(process.cwd(), "src/lib/videos/upload-client.ts"),
  "utf8",
);

describe("video action security boundaries", () => {
  it("authenticates through a member-visible race before creating an admin client", () => {
    const requestAction = actions.slice(
      actions.indexOf("export async function requestVideoUpload"),
      actions.indexOf("async function loadManageableVideo"),
    );
    expect(requestAction.indexOf("requireVisibleRace(raceId)")).toBeGreaterThan(-1);
    expect(requestAction.indexOf("requireVisibleRace(raceId)")).toBeLessThan(
      requestAction.indexOf("createAdminClient()"),
    );
  });

  it("generates the path server-side and prevents signed-upload overwrites", () => {
    expect(actions).toContain("buildVideoStoragePath(");
    expect(actions).toContain("randomBytes(16).toString(\"hex\")");
    expect(actions).toContain("createSignedUploadUrl(path, { upsert: false })");
    expect(actions).not.toContain("input.rawPath");
  });

  it("re-reads trusted paths for confirmation, deletion, and member reads", () => {
    expect(actions).toContain('.select("id, race_id, uploaded_by, raw_path, summary")');
    expect(actions).toContain(".info(video.raw_path)");
    expect(actions).toContain(".createSignedUrl(video.raw_path, VIDEO_READ_URL_TTL_SECONDS)");
  });

  it("uploads the video body directly with observable browser progress", () => {
    expect(clientUpload).toContain('xhr.open("PUT", signedUrl)');
    expect(clientUpload).toContain('xhr.upload.addEventListener("progress"');
    expect(clientUpload).toContain("xhr.send(body)");
  });
});
