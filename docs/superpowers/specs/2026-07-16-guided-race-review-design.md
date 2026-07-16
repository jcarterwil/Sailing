# Guided Race Review (Review Assistant) — Design

- **Date:** 2026-07-16
- **Status:** Design approved in brainstorm; implementation plan pending
- **Related:** Epic #66 (Deterministic Sailing Performance Overview), existing organizer review flow (`/races/[raceId]/review`), corrections model (`race_corrections`)

## 1. Problem

The analysis pipeline already detects data problems (wind-sensor disagreement, dispersed mark clusters, indeterminate finishes) and persists them as typed warnings. The organizer review page already has the correction primitives to fix every one of them (sensor exclusion, manual TWD/TWS, mark and finish geometry, per-boat result overrides). But nothing connects the two:

- Findings are scattered — some only visible as blanks deep inside the Performance report.
- The Review page assumes the organizer already knows what is wrong and where.
- The report renders blanks (correctly: "null is not zero") with no path back to the fix.
- Review work in progress lives only in browser memory; a disconnect or closed tab loses it.

Real example (2026-07-15, "July 7 — Little Traverse Bay"): analysis completed, report unlocked, but all 6 boats showed **Unresolved · unavailable finish geometry** and no course distance. The fix (define finish geometry in Review, reanalyze) was undiscoverable from the report itself.

## 2. Goals

1. After analysis, surface a prioritized, plain-English queue of "points of confusion" with one-click (or one-input) suggested fixes.
2. Persist review progress server-side so the organizer can disconnect and resume — on any device.
3. Show a review-state badge everywhere the report appears, so the fleet knows whether numbers were reviewed.
4. Reuse the existing detection, correction, preview, and reanalysis machinery. No new analytics.

## 3. Non-goals (explicitly parked)

- **Boat identity auto-matching across race nights** — separate design, builds on Boat identity V1 (#125).
- **Publish gate** — decided against: reports remain visible to members as soon as analysis is current (auto-publish); the badge carries review state instead.
- **LLM in the review loop** — decided against for this feature: the wizard is deterministic. The existing wind-review "Explain" LLM button remains as-is.
- **Standalone wizard route** — the guided experience lives inside the existing Review page; a dedicated route can be promoted later if wanted.
- **localStorage draft mirror** — server autosave (~2 s debounce) bounds loss to seconds; fully-offline review cannot load race data anyway.
- **Historical/multi-version corrections** — `race_corrections` stays a single upserted row per race.

## 4. Locked decisions (from brainstorm)

| Decision | Choice |
| --- | --- |
| Overall shape | Approach A (assistant panel on existing Review page) + Approach C's server-persisted draft state |
| Nature of "AI review" | Deterministic wizard: detectors + typed suggested fixes; no LLM proposals |
| Report visibility | Auto-publish with quality badge ("Reviewed ✓" / "N items to review") |
| Draft rule | Drafts NEVER write `race_corrections`; only Apply & re-analyze does |
| Dismissals | Persist by finding fingerprint; survive reanalysis; un-dismissable |

## 5. Architecture

Three pieces, one source of truth (the persisted analysis):

```
race_analyses (warnings, wind quality, provenance)   race_corrections
        \                                                   |
         +--> findings engine (pure) <---- dispositions ----+
                    |                        (race_review_drafts)
        +-----------+-----------+
        |           |           |
  Review Assistant  Badge     Overview card
  (queue panel)   (Report tab, (Session status)
                   public share)
```

### 5.1 Findings engine — `src/lib/review/findings.ts` (new, pure)

`deriveReviewFindings({ analysis, corrections, dispositions }) → ReviewFinding[]`

```ts
type ReviewFinding = {
  fingerprint: string;          // `${code}:${entryId ?? "race"}:${legIndex ?? "-"}` — stable across reanalysis
  code: string;                 // PerformanceWarningCode or wind-quality finding code
  severity: "blocker" | "warning" | "info";
  title: string;                // plain English, e.g. "No finish could be detected for any boat"
  detail: string;               // what it means for the report, e.g. "Finish times, ranks, and deltas are blank."
  target: { tab: "wind" | "course" | "results"; anchor: string };
  suggestedFix: SuggestedFix | null;   // null = manual-only or informational
  status: "open" | "resolved" | "dismissed";
};
```

`SuggestedFix` is a typed union covering only genuinely actionable fixes, each mapping onto an existing correction primitive:

- `exclude-wind-sensor { entryId }`
- `use-detected-wind`
- `finish-fleet-median { requiresInput: "playheadTime" }`
- `mark-fleet-median { pointIndex, requiresInput: "playheadTime" }`
- `use-inferred-result { entryId }`
- `status-override { entryId, suggestedStatus? }`

Priority ordering: finish/results blockers first, then course/marks, then start geometry, then wind quality, then informational.

**Catalog (warning code → finding):**

| Source code | Severity | Suggested fix |
| --- | --- | --- |
| `unavailable-finish-geometry` | blocker | `finish-fleet-median` (walked playhead input) |
| `unresolved-finish` (per boat) | blocker | `use-inferred-result` if available, else `status-override` |
| `incomplete-start-geometry` | warning | jump to start-line controls (detected / pin+committee) |
| `dispersed-mark-cluster` | warning | `mark-fleet-median` |
| `unsupported-mark` | warning | jump to mark time/position + leg-type override |
| `missing-entry-passage` | warning | jump to mark boundaries (adjust times) |
| `non-monotonic-passage` | warning | jump to passage/mark times |
| wind direction outlier / dominance critical | warning | `exclude-wind-sensor` |
| wind estimate disagreement / low strength | warning | jump to manual TWD/TWS or exclusion |
| wind sparse samples | info | none (dismiss or replace track) |
| `insufficient-coverage`, `source-gap` | info | none (dismiss or replace track) |
| `distribution-omitted`, `payload-limited` | info | none (informational) |

Wind rows use descriptive names; the implementation maps the exact finding codes from `src/lib/analytics/wind-quality.ts`.

Because findings are **derived** (not persisted), the Review panel, Report badge, and Overview card can never disagree.

### 5.2 Draft review state — table `race_review_drafts` (new, additive)

```sql
create table public.race_review_drafts (
  race_id uuid primary key references public.races(id) on delete cascade,
  draft jsonb not null,                       -- { version: 1, corrections: <V2 draft>, dispositions: [...], cursor: fingerprint|null }
  base_analysis_computed_at timestamptz,      -- staleness detection
  base_corrections_updated_at timestamptz,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
-- RLS enabled; NO member policies. All access via service-role API routes gated on is_race_organizer
-- (same pattern as race_corrections writes).
```

`dispositions`: `[{ fingerprint, action: "dismissed", note?, at }]`.

**API** (all organizer-gated, service-role):
- `GET /api/races/[raceId]/review-draft` — load (missing table or row ⇒ empty draft, never an error)
- `PUT /api/races/[raceId]/review-draft` — debounced autosave (~2 s + on tab-hide)
- `DELETE /api/races/[raceId]/review-draft` — "Start fresh"

**Critical invariant:** saving a draft never touches `race_corrections`, so it never invalidates the live analysis or report freshness. Only the existing **Apply & re-analyze** (`POST /api/races/[raceId]/corrections`) promotes draft corrections. On successful apply, that route also updates the draft row server-side: clears the corrections portion, keeps dispositions, refreshes `base_*` snapshots (atomic with the apply; no client race).

### 5.3 Badge — shared derivation

`countOpenFindings(analysis, corrections, dispositions) → { open, reviewed }`. States: **"Reviewed ✓"** (0 open) or **"N items to review"**. Surfaces:

- Overview "Session status" card (organizer sees link → `/review`)
- Report tab (`/races/[raceId]/performance`) header
- Public share performance page (`/s/[slug]/performance`) — same badge, transparency-consistent with auto-publish
- Review page (panel header)

Members and public viewers see only the badge/count, never draft contents.

## 6. UX flow

1. **Entry points.** After analysis, Overview card and Report tab show "N items to review" (organizer: links to Review).
2. **Review Assistant panel.** Sidebar on desktop, collapsible bottom sheet on mobile. Findings listed in priority order; one active at a time (step-by-step feel). Each `FindingCard`:
   - Plain-English problem + report impact.
   - **Accept suggested fix** — mutates the same client corrections state the tabs edit; live preview (`useReviewPreview`) updates; relevant control highlights.
   - **Adjust manually** — jumps to tab + anchored control. A finding counts as **resolved** when the draft corrections contain a change addressing it, per its catalog row's mapping (e.g. the finish-geometry finding resolves when the draft sets any finish geometry; a per-boat wind finding resolves when that sensor is excluded or manual wind is set).
   - **Dismiss** — optional note; removes from open count; persisted by fingerprint; a "Dismissed" section allows un-dismissing.
3. **Walked inputs.** Fixes needing one human input focus that input with instruction text, e.g. finish: "Scrub the playhead to when the fleet crossed the finish, then tap *Finish = fleet median*." Accept enables when the input exists.
4. **Resume.** On load with an existing draft: "Resume review — 2 of 5 done · saved 2 h ago by {name}" → **Resume** / **Start fresh**. Autosave is silent with a small "Draft saved" indicator.
5. **Apply.** Queue empty (accepted/adjusted/dismissed) → summary of pending changes → existing **Apply & re-analyze**. After reanalysis: badge flips to Reviewed ✓ (assuming no new findings); panel offers "Open report."

New components: `ReviewAssistantPanel`, `FindingCard`, `useReviewDraft` (load/autosave/resume/staleness), `ReviewStatusBadge`.

## 7. Edge cases & failure handling

- **Apply conflict:** existing corrections endpoint 409s if tracks/corrections changed; client re-derives the queue from fresh analysis, keeps dispositions, and reports what changed.
- **Stale draft:** `base_*` mismatch ⇒ resume banner marked "may be stale"; queue re-derives; accepted-but-unapplied fixes are kept where the finding still exists, discarded-and-listed where it doesn't.
- **Two organizers:** draft is last-write-wins with `updated_by` surfaced; the apply 409 is the real guard.
- **Disconnects:** autosave retries with backoff; indicator shows "Reconnecting — changes not yet saved"; `beforeunload` warns on unsaved changes.
- **Zero findings:** panel shows "No review items"; badge Reviewed ✓ immediately.
- **Practice sessions:** review remains race-only (unchanged).
- **App-first deploy window:** draft API treats a missing table as "no draft" (repo's existing additive-deploy convention).

## 8. Testing (Vitest, existing unit-test patterns)

- **Findings engine:** every catalog row → expected finding shape; fingerprint stability across reanalysis; priority ordering; disposition filtering; zero-warning case.
- **Draft helpers (pure, `corrections.ts`-style):** staleness detection, resume merge, dismissal survival, apply-clears-corrections-keeps-dispositions.
- **Badge:** same inputs give identical counts for panel, Overview, Report surfaces.
- **Static tests:** nav/label additions follow existing `*-static.test.ts` pattern.
- **Acceptance fixture:** the July 7 race — walk the queue, set finish via playhead fleet-median, apply, verify the report's results table resolves (finish, rank, delta populated; provenance shows organizer/inferred correctly).

## 9. Rollout

Additive migration; deploy order irrelevant (see §7 app-first window). Suggested slicing for the implementation plan:

1. Findings engine + badge (read-only value lands first).
2. Draft table + API + `useReviewDraft`.
3. Assistant panel + finding cards + walked inputs.
4. Apply-integration (server-side draft clear) + acceptance pass on the July 7 fixture.

Per repo rules: every PR runs `npm run lint`, `npm run typecheck`, relevant `npm run test`; CI owns `build`; migrations additive; squash-merge only.
