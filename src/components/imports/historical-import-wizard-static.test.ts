import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("historical import wizard routes", () => {
  it("gates start and batch pages with can_edit_boat and notFound for viewers", () => {
    const start = source("src/app/sessions/import/page.tsx");
    const batch = source("src/app/sessions/import/[batchId]/page.tsx");
    const boatHub = source("src/app/boats/[boatId]/page.tsx");
    const readerMigration = source(
      "supabase/migrations/20260715150000_historical_import_batch_reader.sql",
    );

    expect(start).toContain('.rpc("can_edit_boat"');
    expect(start).toContain("notFound()");
    expect(batch).toContain('.rpc(\n    "get_historical_import_batch_for_editor"');
    expect(batch).not.toContain("createAdminClient");
    expect(batch).toContain("notFound()");
    expect(readerMigration).toContain("can_edit_boat(batch_row.boat_id)");
    expect(boatHub).toContain('.rpc("can_edit_boat"');
    expect(boatHub).toContain("Add sailing data");
    expect(boatHub).toContain("/sessions/import?boatId=");
  });

  it("keeps primary actions at min-h-11 for 390px touch targets", () => {
    const wizard = source("src/components/imports/historical-import-wizard.tsx");
    const mapping = source("src/components/imports/session-mapping-card.tsx");
    const list = source("src/components/imports/import-file-list.tsx");

    expect(wizard).toContain("min-h-11");
    expect(wizard).toContain('aria-live="polite"');
    expect(wizard).toContain("Processing resumes while this page is open.");
    expect(wizard).toContain("pb-28");
    expect(mapping).toContain("min-h-11");
    expect(list).toContain("min-h-11");
  });

  it("does not keep mapping/status solely in React state — refreshes from the API", () => {
    const wizard = source("src/components/imports/historical-import-wizard.tsx");
    const list = source("src/components/imports/import-file-list.tsx");
    expect(wizard).toContain("fetchHistoricalImportBatch");
    expect(wizard).toContain("patchHistoricalImportItem");
    expect(wizard).toContain("commitHistoricalImportBatch");
    expect(list).toContain("Choose file again");
    expect(wizard).toContain("onChooseAgain");
  });

  it("uses the pure import-queue reducer for concurrency and process ordering", () => {
    const queue = source("src/components/imports/import-queue.ts");
    const wizard = source("src/components/imports/historical-import-wizard.tsx");
    expect(queue).toContain("MAX_CONCURRENT_FILE_OPS = 2");
    expect(queue).toContain("export function reduceImportQueue");
    expect(wizard).toContain("reduceImportQueue");
    expect(wizard).toContain("processTrack");
  });
});
