import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { HELP_TOOLTIP_DELAY_MS } from "@/components/help/help-tooltip-provider";
import { HELP_TERM_KEYS } from "@/content/help-registry";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("HelpTip accessibility and interaction contracts", () => {
  const tip = source("src/components/help/help-tip.tsx");
  const provider = source("src/components/help/help-tooltip-provider.tsx");
  const layout = source("src/app/layout.tsx");
  const glossary = source("src/app/help/metrics/page.tsx");

  it("uses one root TooltipProvider with a 400 ms delay", () => {
    expect(HELP_TOOLTIP_DELAY_MS).toBe(400);
    expect(provider).toContain("delayDuration={HELP_TOOLTIP_DELAY_MS}");
    expect(layout).toContain("<HelpTooltipProvider>");
    expect(layout).toContain("</HelpTooltipProvider>");
  });

  it("shows a tooltip on hover/focus and a popover on click/touch", () => {
    expect(tip).toContain("TooltipTrigger");
    expect(tip).toContain("TooltipContent");
    expect(tip).toContain("PopoverTrigger");
    expect(tip).toContain("PopoverContent");
    expect(tip).toContain('(pointer: coarse)');
    expect(tip).toContain("open={tooltipOpen}");
    expect(tip).toContain("if (popoverOpen)");
    expect(tip).not.toContain("open={popoverOpen ? false : undefined}");
  });

  it("names the trigger/dialog and dismisses the popover with Escape", () => {
    expect(tip).toContain("aria-label={label}");
    expect(tip).toContain("`Help: ${term.title}`");
    expect(tip).toContain("aria-labelledby={titleId}");
    expect(tip).toContain("onEscapeKeyDown={() => setPopoverOpen(false)}");
    expect(tip).toContain("event.stopPropagation()");
    expect(tip).not.toContain("onPointerDown");
  });

  it("keeps glossary links out of anonymous public performance shares", () => {
    const publicPage = source("src/app/s/[slug]/performance/page.tsx");
    expect(publicPage).toContain("<HelpUiProvider glossaryLink={false}>");
    expect(tip).toContain("glossaryLink");
    expect(tip).toContain("term.body");
  });

  it("keeps popover content viewport-safe at narrow widths", () => {
    expect(tip).toContain("max-w-[calc(100vw-2rem)]");
    expect(tip).toContain("w-[min(18rem,calc(100vw-2rem))]");
  });

  it("links Learn more into the authenticated glossary route", () => {
    expect(tip).toContain("helpGlossaryHref(termKey)");
    expect(tip).toContain("Learn more in the metrics glossary");
    expect(glossary).toContain("<AuthenticatedShell");
    expect(glossary).toContain("listHelpTerms()");
    expect(glossary).toContain("helpTermAnchorId");
    expect(glossary).toContain('redirect("/login")');
  });

  it("wires HelpTip into the issue-named decision surfaces", () => {
    const surfaces = [
      source("src/components/imports/historical-import-wizard.tsx"),
      source("src/components/imports/session-mapping-card.tsx"),
      source("src/app/races/[raceId]/upload-panel.tsx"),
      source("src/app/races/[raceId]/page.tsx"),
      source("src/app/races/[raceId]/reanalyze-button.tsx"),
      source("src/app/races/[raceId]/review/review-page-client.tsx"),
      source("src/components/performance/performance-overview.tsx"),
      source("src/app/races/[raceId]/share-panel.tsx"),
      source("src/app/boats/[boatId]/crew/crew-manager.tsx"),
      source("src/app/races/create-session-dialog.tsx"),
      source("src/components/layout/app-nav.tsx"),
    ].join("\n");

    for (const key of [
      "vkxCsv",
      "replaceTrack",
      "review",
      "reanalyze",
      "publicShare",
      "viewer",
      "editor",
      "sessionType",
      "timezone",
      "analyzedWind",
    ] as const) {
      expect(surfaces).toContain(`termKey="${key}"`);
    }
    // Performance table heads pass registry keys via SortableHead's helpKey.
    expect(surfaces).toContain('helpKey="sog"');
    expect(surfaces).toContain('helpKey="straight"');
    expect(surfaces).toContain('termKey="vmg"');
    expect(surfaces).toContain("<HelpTip termKey={helpKey}");

    expect(surfaces).toContain('href="/help/metrics"');
    expect(HELP_TERM_KEYS.length).toBeGreaterThanOrEqual(21);
  });

  it("keeps required upload limits as visible text outside tooltips", () => {
    const uploadWizard = source("src/components/imports/historical-import-wizard.tsx");
    expect(uploadWizard).toContain("Accepted types: .vkx and .csv");
    expect(uploadWizard).toContain("10&nbsp;MB each");
    expect(uploadWizard).toContain("termKey=\"vkxCsv\"");
  });
});
