import { describe, expect, it } from "vitest";

import {
  extractReplyThreadId,
  normalizeEmailAddress,
  prefixReplySubject,
} from "@/lib/email/addresses";

describe("email address helpers", () => {
  it("normalizes plain and display-name addresses", () => {
    expect(normalizeEmailAddress("MEMBER@Example.com")).toBe("member@example.com");
    expect(normalizeEmailAddress("Member Name <MEMBER@Example.com>")).toBe(
      "member@example.com",
    );
    expect(normalizeEmailAddress("not an address")).toBeNull();
  });

  it("extracts an unguessable reply thread from any received address", () => {
    expect(
      extractReplyThreadId([
        "notifications@example.com",
        "reply+550e8400-e29b-41d4-a716-446655440000@reply.example.com",
      ]),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(extractReplyThreadId(["reply+not-a-uuid@reply.example.com"])).toBeNull();
  });

  it("adds Re only once", () => {
    expect(prefixReplySubject("Race update")).toBe("Re: Race update");
    expect(prefixReplySubject("re: Race update")).toBe("re: Race update");
  });
});
