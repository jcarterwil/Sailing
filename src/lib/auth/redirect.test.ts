import { describe, expect, it } from "vitest";

import { getSafeNextPath } from "@/lib/auth/redirect";

describe("safe authentication redirects", () => {
  it("keeps local destinations with query parameters", () => {
    expect(getSafeNextPath("/claim?code=ABCD2345")).toBe("/claim?code=ABCD2345");
  });

  it.each([
    "https://evil.example/claim",
    "//evil.example/claim",
    "/\\evil.example/claim",
    "/claim\nhttps://evil.example",
  ])("rejects unsafe destination %s", (value) => {
    expect(getSafeNextPath(value)).toBe("/dashboard");
  });
});
