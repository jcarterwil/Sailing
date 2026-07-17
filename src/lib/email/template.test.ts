import { describe, expect, it } from "vitest";

import { buildPlainTextEmail, renderSailingEmail } from "@/lib/email/template";

const props = {
  preview: "Race update",
  heading: "Track ready",
  recipientName: "Taylor",
  body: "Review <script>alert('x')</script> safely.",
  ctaLabel: "Open race",
  ctaUrl: "https://example.com/races/1",
  preferencesUrl: "https://example.com/account/notifications",
};

describe("Sailing email template", () => {
  it("escapes member/admin content while keeping controlled links", async () => {
    const html = await renderSailingEmail(props);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('href="https://example.com/races/1"');
    expect(html).toContain('href="https://example.com/account/notifications"');
  });

  it("includes the same actions in the plain-text alternative", () => {
    const text = buildPlainTextEmail(props);
    expect(text).toContain("Hi Taylor,");
    expect(text).toContain("Open race: https://example.com/races/1");
    expect(text).toContain("Manage email preferences");
  });
});
