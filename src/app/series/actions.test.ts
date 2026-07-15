import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const actions = readFileSync(resolve(process.cwd(), "src/app/series/actions.ts"), "utf8");
const loader = readFileSync(resolve(process.cwd(), "src/lib/series/server.ts"), "utf8");

describe("series organizer server boundary", () => {
  it("authenticates every exported mutation before relying on service-role writes", () => {
    for (const actionName of [
      "createSeries",
      "saveSeriesSetup",
      "archiveSeries",
      "toggleSeriesShare",
      "previewSeriesScoring",
      "applySeriesScoring",
    ]) {
      const start = actions.indexOf(`export async function ${actionName}`);
      expect(start).toBeGreaterThan(-1);
      const nextExport = actions.indexOf("\nexport async function ", start + 1);
      const body = actions.slice(start, nextExport === -1 ? undefined : nextExport);
      expect(body).toContain("requireActor()");
    }
    const saveStart = actions.indexOf("export async function saveSeriesSetup");
    expect(actions.indexOf("requireActor()", saveStart))
      .toBeLessThan(actions.indexOf("createAdminClient()", saveStart));
  });

  it("re-reads authoritative evidence and never accepts browser analysis JSON", () => {
    const applyStart = actions.indexOf("export async function applySeriesScoring");
    const applyBody = actions.slice(applyStart);
    expect(applyBody).toContain("loadSeriesEditorModel(supabase, user.id, input.seriesId)");
    expect(applyBody).toContain("expected_revision_input: input.expectedRevision");
    expect(applyBody).toContain("snapshot_result_input: projection.result");
    expect(applyBody).not.toMatch(/input\.(?:analysis|corrections|sourceVersion)/);
    expect(loader).toContain('.from("race_analyses")');
    expect(loader).toContain('.from("race_corrections")');
    expect(loader).toContain('.from("race_entries")');
    expect(loader).toContain("source_revision");
  });

  it("uses the same projection for preview and persisted snapshot input", () => {
    expect(actions).toContain("const preview = previewFromModel(model, input.draftOfficialResults)");
    expect(actions).toContain("const { projection } = preview");
    expect(actions).toContain("snapshot_fingerprint_input: projection.result.sourceFingerprint");
    expect(actions).toContain("snapshot_result_input: projection.result as unknown as Json");
  });
});
