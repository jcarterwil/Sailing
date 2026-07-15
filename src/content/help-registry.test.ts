import { describe, expect, it } from "vitest";

import {
  HELP_PROVENANCE,
  HELP_REGISTRY,
  HELP_TERM_KEYS,
  getHelpTerm,
  helpGlossaryHref,
  helpTermAnchorId,
  listHelpTerms,
  type HelpTermKey,
} from "@/content/help-registry";

const REQUIRED_ISSUE_TITLES = [
  "SOG",
  "COG",
  "HDG",
  "TWD",
  "TWS",
  "VMG",
  "Course efficiency",
  "Straight",
  "Maneuver",
  "Analyzed wind",
  "Analyzed weather",
  "Confidence",
  "Provenance",
  "Coverage",
  "Replace track",
  "VKX and CSV",
  "Public share",
  "Viewer",
  "Editor",
  "Review",
  "Reanalyze",
] as const;

describe("help registry", () => {
  it("has unique typed keys with no duplicates", () => {
    expect(new Set(HELP_TERM_KEYS).size).toBe(HELP_TERM_KEYS.length);
    expect(Object.keys(HELP_REGISTRY).sort()).toEqual([...HELP_TERM_KEYS].sort());
  });

  it("lists every registry entry once for the glossary", () => {
    const terms = listHelpTerms();
    expect(terms).toHaveLength(HELP_TERM_KEYS.length);
    expect(terms.map((term) => term.key)).toEqual([...HELP_TERM_KEYS]);
  });

  it("covers every issue-required term title", () => {
    const titles = new Set(listHelpTerms().map((term) => term.title));
    for (const title of REQUIRED_ISSUE_TITLES) {
      expect(titles.has(title)).toBe(true);
    }
  });

  it("requires summary, body, and matching key on every entry", () => {
    for (const key of HELP_TERM_KEYS) {
      const term = getHelpTerm(key);
      expect(term.key).toBe(key);
      expect(term.title.trim().length).toBeGreaterThan(0);
      expect(term.summary.trim().length).toBeGreaterThan(0);
      expect(term.body.trim().length).toBeGreaterThan(term.summary.trim().length);
      expect(term.summary.includes("\n")).toBe(false);
      if (term.provenance) {
        expect(HELP_PROVENANCE).toContain(term.provenance);
      }
    }
  });

  it("states units or frame for core sailing metrics", () => {
    const metricKeys: HelpTermKey[] = [
      "sog",
      "cog",
      "hdg",
      "twd",
      "tws",
      "vmg",
      "courseEfficiency",
    ];
    for (const key of metricKeys) {
      const term = getHelpTerm(key);
      expect(Boolean(term.units || term.frame)).toBe(true);
      expect(term.provenance).toBeTruthy();
    }
  });

  it("builds stable glossary anchors and hrefs", () => {
    expect(helpTermAnchorId("vmg")).toBe("help-vmg");
    expect(helpGlossaryHref("vmg")).toBe("/help/metrics#help-vmg");
    expect(helpGlossaryHref()).toBe("/help/metrics");
  });

  it("does not promise causation or invent Practice race zeros", () => {
    const corpus = listHelpTerms()
      .map((term) => `${term.summary} ${term.body}`)
      .join("\n")
      .toLowerCase();
    expect(corpus).toMatch(/not a causal|does not establish|does not imply causation|association/);
    expect(corpus).toMatch(/never numeric zero|not shown as zero|instead of inventing zeros|instead of shown as zero/);
  });
});

