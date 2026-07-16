import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Boat Hub Performance + Setup surfaces (#174)", () => {
  it("keeps association language and Practice race-only copy", () => {
    const panel = source("src/components/boats/boat-performance-panel.tsx");
    expect(panel).toContain("never causation");
    expect(panel).toContain("practice-session");
    expect(panel).toContain("never rendered as zero");
    expect(panel).toContain("Export compact CSV");
    expect(panel).toContain("no raw-track export");
    expect(panel).toContain("sessionWorkspaceHref");
    expect(panel).toContain('name="crew"');
    expect(panel).toContain('name="sail"');
    expect(panel).toContain('name="setup"');
    expect(panel).toContain('name="condition"');
    expect(panel).toContain("Not in observation V1");
  });

  it("wires Setup catalogs and immutable snapshot attach", () => {
    const setup = source("src/components/boats/boat-setup-panel.tsx");
    const actions = source("src/app/boats/metadata-actions.ts");
    expect(setup).toContain("saveSessionMetadataSnapshotAction");
    expect(setup).toContain("Attach Session snapshot");
    expect(setup).toContain("do not rewrite frozen snapshot text");
    expect(actions).toContain("save_session_metadata_snapshot");
    expect(actions).toContain("archiveBoatCrewPerson");
    expect(actions).toContain("can_edit_boat");
  });
});
