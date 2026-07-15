import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const boundarySource = readFileSync(
  new URL("./broadcast-3d.tsx", import.meta.url),
  "utf8",
);

describe("Broadcast 3D lazy boundary", () => {
  it("loads Three only from the mounted client boundary", () => {
    expect(boundarySource).toContain('import("three")');
    expect(boundarySource).not.toMatch(
      /^\s*import(?:\s+type)?[\s\S]*?from\s+["']three["']/m,
    );
  });

  it("uses the replay publication source without another clock", () => {
    expect(boundarySource).toContain("source.subscribe");
    expect(boundarySource).not.toContain("requestAnimationFrame");
    expect(boundarySource).not.toContain("setAnimationLoop");
    expect(boundarySource).not.toContain("setInterval(");
    expect(boundarySource).not.toContain("setTimeout(");
  });
});
