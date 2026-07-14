import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const actions = readFileSync(resolve(process.cwd(), "src/app/races/actions.ts"), "utf8");
const uploadPanel = readFileSync(
  resolve(process.cwd(), "src/app/races/[raceId]/upload-panel.tsx"),
  "utf8",
);

describe("stable boat server-action boundaries", () => {
  it("uses transactional RPCs instead of creating boats from filenames", () => {
    expect(actions).toContain('.rpc("join_race_with_boat"');
    expect(actions).toContain('.rpc("create_race_entry_for_boat"');
    expect(actions).not.toContain("createEntryFromFile");
  });

  it("file selection creates mapping drafts and makes no durable call", () => {
    const selectionHandler = uploadPanel.slice(
      uploadPanel.indexOf("async function handleBulkFiles"),
      uploadPanel.indexOf("function updateMapping"),
    );
    expect(selectionHandler).toContain("buildFleetMappingDrafts");
    expect(selectionHandler).toContain("setPendingMappings");
    expect(selectionHandler).not.toContain("createRaceEntryForFleetFile");
    expect(selectionHandler).not.toContain("requestTrackUpload");
  });

  it("keeps existing entry upload and Replace on the signed upsert path", () => {
    expect(uploadPanel).toContain("requestTrackUpload(entryId, file.name, file.size)");
    expect(uploadPanel).toContain("uploadToSignedUrl(grant.path, grant.token, file, { upsert: true })");
    expect(uploadPanel).toContain('{entry.track ? "Replace" : "Upload"}');
  });
});
