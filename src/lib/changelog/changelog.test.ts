import { describe, expect, it } from "vitest";

import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";
import {
  formatChangelogDate,
  getChangelogEntries,
  getLatestChangelogId,
  hasUnreadChangelog,
} from "@/lib/changelog/index";

describe("product changelog", () => {
  it("keeps newest-first order and unique ids", () => {
    const ids = CHANGELOG_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (let i = 1; i < CHANGELOG_ENTRIES.length; i += 1) {
      expect(CHANGELOG_ENTRIES[i - 1]!.date >= CHANGELOG_ENTRIES[i]!.date).toBe(
        true,
      );
    }
  });

  it("requires sailor-facing copy and GitHub PR linkage", () => {
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.summary.trim().length).toBeGreaterThan(20);
      expect(entry.prs.length).toBeGreaterThan(0);
    }
  });

  it("exposes a defensive copy of entries", () => {
    const copy = getChangelogEntries();
    copy.pop();
    expect(getChangelogEntries().length).toBe(CHANGELOG_ENTRIES.length);
  });

  it("tracks unread state from the newest entry id", () => {
    const latest = getLatestChangelogId();
    expect(latest).toBe(CHANGELOG_ENTRIES[0]!.id);
    expect(hasUnreadChangelog(null)).toBe(true);
    expect(hasUnreadChangelog(latest)).toBe(false);
    expect(hasUnreadChangelog("older-id")).toBe(true);
  });

  it("formats ISO dates in UTC", () => {
    expect(formatChangelogDate("2026-07-17")).toBe("Jul 17, 2026");
    expect(formatChangelogDate("not-a-date")).toBe("not-a-date");
  });
});
