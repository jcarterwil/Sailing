import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("historical import API boundaries", () => {
  it("gates every boat import route with can_edit_boat and Not allowed", () => {
    const routes = [
      "src/app/api/boats/[boatId]/historical-imports/route.ts",
      "src/app/api/boats/[boatId]/historical-imports/[batchId]/route.ts",
      "src/app/api/boats/[boatId]/historical-imports/[batchId]/items/route.ts",
      "src/app/api/boats/[boatId]/historical-imports/[batchId]/items/[itemId]/route.ts",
      "src/app/api/boats/[boatId]/historical-imports/[batchId]/items/[itemId]/inspect/route.ts",
      "src/app/api/boats/[boatId]/historical-imports/[batchId]/commit/route.ts",
    ];
    for (const route of routes) {
      const body = source(route);
      expect(body).toContain("requireBoatEditor");
      expect(body).not.toContain("SUPABASE_SECRET");
      // Public JSON helpers must not expose stagingPath; server may read staging_path.
      expect(body).not.toContain("stagingPath:");
    }
    expect(source("src/lib/imports/auth.ts")).toContain('jsonError("Not allowed.", 403)');
    expect(source("src/lib/imports/auth.ts")).toContain('.rpc("can_edit_boat"');
  });

  it("never returns storage paths from public serializers", () => {
    const serialize = source("src/lib/imports/serialize.ts");
    expect(serialize).toContain("toPublicItem");
    expect(serialize).not.toMatch(/stagingPath:/);
    expect(serialize).toContain("stagingPathForItem");
  });

  it("enforces batch limits before issuing upload instructions", () => {
    const items = source(
      "src/app/api/boats/[boatId]/historical-imports/[batchId]/items/route.ts",
    );
    expect(items).toContain("HISTORICAL_IMPORT_MAX_FILES");
    expect(items).toContain("HISTORICAL_IMPORT_MAX_BATCH_BYTES");
    expect(items).toContain("createSignedUploadUrl");
    expect(items).toContain("upsert: false");
    expect(items).toContain("uploadUrl: signed.signedUrl");
    expect(items).not.toContain("token:");
  });

  it("hashes regular track uploads during process", () => {
    const process = source("src/app/api/tracks/[trackId]/process/route.ts");
    expect(process).toContain("sha256HexBytes");
    expect(process).toContain("content_sha256");
  });
});
