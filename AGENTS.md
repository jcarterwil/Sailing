<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sailing — agent guide

A sailing race-performance app: racers upload GPS tracking data (Vakaros `.vkx` / CSV), replay the race on a map, and generate a coach report ("Race Dossier"). Next.js 16 App Router + React 19 + TypeScript + Tailwind 4 + shadcn/ui, on Supabase (Auth + Postgres + Storage) and Vercel.

Directory-specific guides exist — read the `AGENTS.md` nearest the code you touch:
- `src/lib/analytics/AGENTS.md` — parsers, wind/maneuver algorithms, angle conventions
- `src/components/replay/AGENTS.md` — map + 60fps playback architecture
- `supabase/AGENTS.md` — schema, RLS idioms, how migrations reach the database

## Golden rules

1. **Read the Next.js 16 docs before writing framework code.** Request interception is `src/proxy.ts` (the renamed `middleware.ts`). Data pages use `export const dynamic = "force-dynamic"`; route handlers take `params: Promise<{…}>`. Confirm conventions in `node_modules/next/dist/docs/` rather than from memory.
2. **`npm run verify` must pass before any PR** — it runs lint → typecheck → vitest → build. It is the CI gate.
3. **Surgical changes only.** Match surrounding style; touch only what the task needs; don't refactor adjacent code.
4. **Never put a secret in a `NEXT_PUBLIC_` variable.** The service-role key (`SUPABASE_SECRET_KEY`) is server-only via `src/lib/supabase/admin.ts` (`import "server-only"`). Client and server components use the publishable key.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run verify` | **Pre-PR gate:** lint, typecheck, test, build |
| `npm run test` | Vitest (analytics golden tests) |
| `npm run db:push` | Apply pending migrations to the linked Supabase project |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` after a schema change |
| `npx tsx scripts/seed-example-race.ts` | Seed the demo race from `Examples/` (idempotent) |

Package manager: npm. Path alias `@/*` → `src/*`. No test runner beyond Vitest (scoped to `src/**/*.test.ts`).

## Repo map

- `src/app` — routes. Auth under `src/app/auth/*`; races under `src/app/races/*`; API route handlers under `src/app/api/*`.
- `src/app/races/actions.ts` — server actions (create/join race, request upload, etc.). Files upload **direct to Storage** via signed URLs — never through a server action (1MB body cap).
- `src/lib/analytics` — pure, dependency-free domain engine (parsers, cleaning, and the wind/maneuver/race algorithms as they land).
- `src/lib/supabase` — three clients: `client.ts` (browser), `server.ts` (RSC/route handlers), `admin.ts` (service role, server-only), plus `proxy.ts` (session refresh).
- `src/components/replay` — the client-only race replay (map, playback, timeline).
- `supabase/migrations` — schema history; `supabase/config.toml` — local/project config.
- `Examples/` — real fleet track files and reference PDFs. **Git-ignored (personal correspondence); never commit.**

## How changes reach production

- **App code:** push to `main` → Vercel builds and deploys automatically. Primary domain `https://sailing-performance.vercel.app`.
- **Database:** the **Supabase GitHub integration** is connected to this repo with *Deploy to production* enabled on `main`. Supabase applies any new `supabase/migrations/` file automatically when it merges to `main` — no CI secrets, no manual step. (Locally you can still run `npm run db:push` to apply immediately.) Migrations must be **additive/backward-compatible** so app and schema can deploy in either order. After changing schema, run `npm run db:types` and commit the regenerated types. See `supabase/AGENTS.md`.

## Pull request review gate

Every code change must complete this sequence before merge:

1. Run `npm run verify` and fix failures attributable to the change.
2. Open the pull request and mark it ready for review.
3. Request the installed native Codex reviewer by posting the exact PR comment `@codex review`.
4. Wait for Codex to finish. An eyes reaction means the request was accepted, not that the review is complete.
5. Address every material finding, rerun relevant checks, and request another Codex review after substantive fixes.
6. Merge only after Codex has posted its completed review and no material finding remains unresolved.

Do not replace the installed GitHub integration with a custom API-key GitHub Action. If Codex does not
respond or cannot run, report that blocker explicitly rather than silently merging without the review.

## Security must-dos (every endpoint and query)

- **RLS on every table**, scoped with the `(select auth.uid())` idiom. New tables follow the pattern in `supabase/migrations`.
- **Anonymous access is server-mediated only.** There are no anon RLS policies; public share pages resolve via the admin client after a slug lookup. Do not add anon policies.
- **The admin (service-role) client bypasses RLS** — every call site must do its own authorization check first (membership, organizer, or admin).
- **Post-auth redirects** go through `getSafeNextPath` (`src/lib/auth/redirect.ts`) — an open-redirect guard.
