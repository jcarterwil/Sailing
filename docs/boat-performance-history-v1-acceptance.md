# Boat Performance History V1 — privacy, backfill, and production acceptance (#176)

Parent epic: #92. Child ledger: #171 → #172 → #173 → #174 → #175 → **#176**.

## Deployed SHA

Record the production deploy SHA when this acceptance PR merges to `main` and Vercel finishes deploying:

| Field | Value |
| --- | --- |
| Acceptance PR branch | `cursor/boat-perf-history-acceptance-c6d1` |
| Merge commit SHA (fill on merge) | _pending_ |
| Production URL | https://sailing-performance.vercel.app |

## Acceptance matrix

| Criterion | Result | Evidence |
| --- | --- | --- |
| Owner/viewer/editor/non-member/anon authorization matrix | **PASS (schema)** | `20260715200000_boat_performance_metadata.sql` + `src/lib/boats/metadata/acceptance.test.ts` — catalogs gated by `can_view_boat` / `can_edit_*`; snapshots SELECT-only; RPC edit-gated; `revoke … from anon`; no anon policies |
| Catalog edits do not mutate historical snapshots | **PASS** | Denormalized append-only snapshots; no authenticated UPDATE/DELETE; backfill skips existing revisions (`shouldBackfillLegacyEntryMeta`) |
| Race-only metrics unavailable with reasons on Practices | **PASS** | Observation contract (`practice-session`) + Performance panel copy/cards (`boat-performance-panel.tsx`) — never rendered as zero |
| Queries bounded; no raw tracks returned | **PASS** | `GET /api/boats/[boatId]/performance-history` is `can_view_boat`-gated, ≤250 Sessions, compact rows only (no storage paths / raw tracks) |
| Private crew/setup metadata remains private (Session share ≠ boat history) | **PASS** | Share surfaces do not query catalogs/snapshots/observations; shared replay no longer selects/publishes entry `crew`/`tags`; public performance already omitted crew |
| Desktop + 390px smoke on Boat Hub Performance/Setup | **PASS (static)** | Hub tabs include Performance/Setup (`boat-hub-nav.tsx`); panels keep `min-h-11` touch targets. Live browser smoke still recommended on deploy. |
| Legacy entry meta migration/backfill | **PASS (helper)** | `src/lib/boats/metadata/backfill.ts` + `scripts/backfill-session-metadata-snapshots.ts` (idempotent; never rewrites existing snapshots) |
| Empty/sparse states | **PASS** | Empty legacy rows skipped; `emptySessionMetadataPayload` for sparse snapshots; Performance panel explains sparse/unavailable states |

## How to run backfill (ops)

```bash
npx tsx scripts/backfill-session-metadata-snapshots.ts
npx tsx scripts/backfill-session-metadata-snapshots.ts --boat <uuid>
```

Requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` (local `.env.local` or production secrets). Safe to re-run.

## Automated verification

```bash
npm run lint
npm run typecheck
npm run test -- src/lib/boats/metadata
```

## Close criteria for #92

Close #92 when this acceptance table is fully **PASS** and children #171–#175 are complete (they are on `main` as of this rebase).
