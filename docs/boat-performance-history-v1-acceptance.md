# Boat Performance History V1 — privacy, backfill, and production acceptance (#176)

Parent epic: #92. Child ledger: #171 → #172 → #173 → #174 → #175 → **#176**.

## Deployed SHA

| Field | Value |
| --- | --- |
| Acceptance merge commit | `58745a8` (`#184`) |
| Production URL | https://sailing-performance.vercel.app |
| Cleanup follow-up | merge remount + observation soft-fail hardening (see cleanup PR) |

## Acceptance matrix

| Criterion | Result | Evidence |
| --- | --- | --- |
| Owner/viewer/editor/non-member/anon authorization matrix | **PASS (schema)** | Metadata + observation migrations; catalogs gated by `can_view_boat` / `can_edit_active_boat`; snapshots SELECT-only; RPC edit-gated; `revoke … from anon`; no anon policies |
| Catalog edits do not mutate historical snapshots | **PASS** | Denormalized append-only snapshots; no authenticated UPDATE/DELETE; backfill skips existing revisions |
| Race-only metrics unavailable with reasons on Practices | **PASS** | Observation contract (`practice-session`) + Performance panel copy — never rendered as zero |
| Queries bounded; no raw tracks returned | **PASS** | `GET /api/boats/[boatId]/performance-history` is `can_view_boat`-gated, ≤250 Sessions, compact rows only |
| Private crew/setup metadata remains private | **PASS** | Share surfaces do not query catalogs/snapshots/observations; shared replay omits entry `crew`/`tags` |
| Desktop + 390px smoke on Boat Hub Performance/Setup | **PASS (static)** | Hub tabs + `min-h-11` touch targets. Live browser smoke still recommended on deploy. |
| Legacy entry meta migration/backfill | **PASS (helper)** | Snapshot + observation backfill scripts (idempotent). Must be run once per environment with existing analyses. |
| Empty/sparse states | **PASS** | Empty legacy rows skipped; sparse snapshot/observation empty states explained in UI |
| Coach generation authorization | **PASS** | `GET` handoff for viewers; `POST` generation requires `can_edit_boat` |

## How to run backfill (ops)

Run **both** after migrations on an environment that already has `race_analyses` / legacy entry meta:

```bash
# Compact existing Performance Overview rows into boat_session_observations
npx tsx scripts/backfill-boat-session-observations.ts

# Freeze legacy race_entries.crew/tags (+ race conditions) into session_metadata_snapshots
npx tsx scripts/backfill-session-metadata-snapshots.ts
npx tsx scripts/backfill-session-metadata-snapshots.ts --boat <uuid>
```

Requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` (local `.env.local` or production secrets). Safe to re-run.

Without the observation backfill, Boat Hub Performance stays empty for races analyzed before `#172` until those races are re-analyzed.

## Automated verification

```bash
npm run lint
npm run typecheck
npm run test -- src/lib/boats/metadata src/lib/boats/observations src/lib/boats/performance-history
```
