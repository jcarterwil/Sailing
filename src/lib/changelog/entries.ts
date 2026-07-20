import type { ChangelogEntry } from "@/lib/changelog/types";

/**
 * Product changelog shown in the authenticated header "What's new" notice.
 *
 * Keep newest first. When shipping a sailor-facing feature, prepend an entry
 * that summarizes the merged GitHub work (PR titles/bodies), not CI/docs noise.
 * See `AGENTS.md` → Product changelog.
 */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: "2026-07-17-plans-billing",
    date: "2026-07-17",
    title: "Plans & billing",
    summary:
      "Choose Free, User, or Club plans from Account → Plans & billing, with Stripe Checkout and a customer portal when payments are enabled.",
    prs: [203],
  },
  {
    id: "2026-07-16-guided-race-review",
    date: "2026-07-16",
    title: "Guided Race Review",
    summary:
      "Organizers get a Review Assistant with resumable drafts, review-state badges, and playhead-aware finish/boundary controls so analysis warnings are easier to clear.",
    prs: [195, 196, 198],
  },
  {
    id: "2026-07-16-boat-performance-history",
    date: "2026-07-16",
    title: "Boat Performance History",
    summary:
      "Boat Hub now tracks comparable session observations with Performance and Setup views, trend summaries, compact export, and cited Coach handoff.",
    prs: [177, 180, 181, 184, 185, 186, 187],
  },
  {
    id: "2026-07-15-mobile-replay",
    date: "2026-07-15",
    title: "Mobile replay controls",
    summary:
      "Race replay is easier on phones: larger touch targets, safer overlay placement, and controls that stay out of the way of the map.",
    prs: [170],
  },
  {
    id: "2026-07-15-help-glossary",
    date: "2026-07-15",
    title: "Metrics glossary & help tips",
    summary:
      "Shared metric definitions and accessible help tips explain speed, VMG, and other race metrics wherever they appear.",
    prs: [166],
  },
  {
    id: "2026-07-15-session-workspace",
    date: "2026-07-15",
    title: "Session workspace",
    summary:
      "Race and practice sessions share one workspace with clearer tabs and a single primary next action instead of competing buttons.",
    prs: [164, 169],
  },
  {
    id: "2026-07-15-my-sailing-boat-hub",
    date: "2026-07-15",
    title: "My Sailing & Boat Hub",
    summary:
      "Signed-in home is sailor- and boat-centric: My Sailing lists your sessions, and Boat Hub gathers crew, imports, and boat context in one place.",
    prs: [163],
  },
  {
    id: "2026-07-15-historical-import",
    date: "2026-07-15",
    title: "Historical track import",
    summary:
      "Import past Vakaros and CSV tracks through a boat-centric wizard with preflight checks and a reload-safe processing queue.",
    prs: [161, 162],
  },
];
