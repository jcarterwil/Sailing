import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const editor = readFileSync(
  resolve(process.cwd(), "src/app/series/[seriesId]/edit/series-workflow-editor.tsx"),
  "utf8",
);

describe("series workflow saved-setup boundary", () => {
  it("marks setup edits dirty and clears any obsolete preview", () => {
    expect(editor).toContain("const [setupDirty, setSetupDirty] = useState(false)");
    expect(editor).toContain("function markSetupChanged()");
    expect(editor).toContain("setSetupDirty(true)");
    expect(editor).toContain("setPreview(null)");
  });

  it("disables official decisions, Preview, and Apply while setup is unsaved", () => {
    expect(editor).toContain("<fieldset");
    expect(editor).toContain("disabled={setupDirty || pending}");
    expect(editor).toContain("pending || setupDirty || model.races.length === 0");
    expect(editor).toContain("pending || setupDirty || preview?.projection.status");
    expect(editor).toContain("Save setup before confirming results");
  });

  it("also fails closed inside both server-action event handlers", () => {
    expect(editor).toContain("Save setup changes before previewing official results.");
    expect(editor).toContain("Save setup changes before applying a scoring snapshot.");
  });
});
