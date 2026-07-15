import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const activeBoats = readFileSync(
  resolve(process.cwd(), "src/lib/boats/active-boats.ts"),
  "utf8",
);
const mySailing = readFileSync(resolve(process.cwd(), "src/lib/boats/my-sailing.ts"), "utf8");
const boatHub = readFileSync(
  resolve(process.cwd(), "src/app/boats/[boatId]/page.tsx"),
  "utf8",
);
const adminActions = readFileSync(resolve(process.cwd(), "src/app/admin/actions.ts"), "utf8");

describe("boat merge application contracts", () => {
  it("filters tombstones from active and viewable boat selectors", () => {
    expect(activeBoats).toContain('.is("merged_into_id", null)');
    expect(mySailing).toContain('.is("merged_into_id", null)');
  });

  it("resolves dashboard ?boat= tombstones to the canonical boat", () => {
    expect(mySailing).toContain("resolveMergedBoatId");
    expect(mySailing).toContain("merged_into_id");
  });

  it("redirects merged boat hub urls to the canonical boat", () => {
    expect(boatHub).toContain("merged_into_id");
    expect(boatHub).toContain("redirect(`/boats/${boatMeta.merged_into_id}");
  });

  it("exposes admin preview and merge actions without claim secrets in preview helpers", () => {
    expect(adminActions).toContain("previewBoatMerge");
    expect(adminActions).toContain("mergeDuplicateBoats");
    expect(adminActions).toContain('rpc("merge_boats"');
    expect(adminActions).toContain("listAllIds");
    expect(adminActions).toMatch(/regenerateClaimCode[\s\S]*merged_into_id/);
    expect(adminActions).toMatch(/sendBoatOwnerInvitation[\s\S]*merged_into_id/);
  });
});
