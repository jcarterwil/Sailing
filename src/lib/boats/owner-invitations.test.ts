import { describe, expect, it } from "vitest";

import {
  getAuthCompletionPath,
  getOwnerInvitationPath,
  getOwnerInvitationUrl,
  normalizeOwnerInvitationCode,
} from "@/lib/boats/owner-invitations";

describe("boat owner invitation links", () => {
  it("normalizes human-entered invitation codes", () => {
    expect(normalizeOwnerInvitationCode("  abcd2345 ")).toBe("ABCD2345");
  });

  it("builds a shareable claim path", () => {
    expect(getOwnerInvitationPath(" abcd2345 ")).toBe("/claim?code=ABCD2345");
    expect(getOwnerInvitationUrl("https://sailing.example/", "abcd2345")).toBe(
      "https://sailing.example/claim?code=ABCD2345",
    );
  });

  it("preserves the invitation through authentication", () => {
    expect(getAuthCompletionPath("/claim?code=ABCD2345")).toBe(
      "/auth/complete?next=%2Fclaim%3Fcode%3DABCD2345",
    );
  });

  it("rejects an unsafe post-authentication destination", () => {
    expect(getAuthCompletionPath("https://evil.example/claim")).toBe(
      "/auth/complete?next=%2Fdashboard",
    );
  });
});
