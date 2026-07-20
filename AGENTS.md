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
2. **CI is the build/test gate — let it run.** GitHub Actions runs `npm run verify` (lint → typecheck → test → build) on every PR and on push to `main`; that check is authoritative. When working locally in Codex, run the fast, reliable pieces — `npm run lint`, `npm run typecheck`, and the `npm run test` cases relevant to your change. **Do not attempt or require a local production `build` during Codex work.** In constrained or cloud sandboxes it is flaky and expensive; push the branch and let GitHub CI build/test, then fix whatever CI flags. (The `build` step needs real time and memory, so the GitHub runner is the intended owner of it.)
3. **Surgical changes only.** Match surrounding style; touch only what the task needs; don't refactor adjacent code.
4. **Never put a secret in a `NEXT_PUBLIC_` variable.** The service-role key (`SUPABASE_SECRET_KEY`) is server-only via `src/lib/supabase/admin.ts` (`import "server-only"`). Client and server components use the publishable key.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run lint` | Fast local ESLint check |
| `npm run typecheck` | Fast local TypeScript check |
| `npm run test` | Vitest (analytics golden tests) |
| `npm run verify` | **CI-owned full npm gate:** lint, typecheck, test, build |
| `npm run db:push` | Apply pending migrations to the linked Supabase project |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` after a schema change |
| `npx tsx scripts/seed-example-race.ts` | Seed the demo race from `Examples/` (idempotent) |

Package manager: npm. Path alias `@/*` → `src/*`. No test runner beyond Vitest (scoped to `src/**/*.test.ts`).

## Repo map

- `src/app` — routes. Auth under `src/app/auth/*`; races under `src/app/races/*`; API route handlers under `src/app/api/*`.
- `src/app/races/actions.ts` — server actions (create/join race, request upload, etc.). Files upload **direct to Storage** via signed URLs — never through a server action (1MB body cap).
- `src/lib/analytics` — pure, dependency-free domain engine (parsers, cleaning, and the wind/maneuver/race algorithms as they land).
- `src/lib/changelog` — product “What’s new” entries shown in the authenticated header (`WhatsNewNotice` in `AppNav`). Summarize sailor-facing work from merged PRs here.
- `src/lib/supabase` — three clients: `client.ts` (browser), `server.ts` (RSC/route handlers), `admin.ts` (service role, server-only), plus `proxy.ts` (session refresh).
- `src/components/replay` — the client-only race replay (map, playback, timeline).
- `supabase/migrations` — schema history; `supabase/config.toml` — local/project config.
- `Examples/` — real fleet track files and reference PDFs. **Git-ignored (personal correspondence); never commit.**

## Product changelog

When a PR ships **sailor-facing** product changes, prepend a short entry to `src/lib/changelog/entries.ts` (newest first):

1. Summarize the merged GitHub work in plain language (title + 1–2 sentence summary). Prefer one digest entry for a multi-PR epic over listing every child PR.
2. Set `id` to `YYYY-MM-DD-slug`, `date` to the merge day (UTC), and `prs` to the merged PR number(s).
3. Skip CI, docs-only, dependency, and admin-tooling-only changes unless they change something sailors see in the app.

The header unread dot clears when a user opens What’s new (localStorage).

## How changes reach production

- **CI:** `.github/workflows/ci.yml` runs dependency review and `npm run verify` (lint → typecheck → test → build) on every PR, and `npm run verify` on every push to `main`, on **Node 24** with inert placeholder public env vars (no secrets — server secrets are read at request time, not during the build). This is the automated gate; treat a red `verify` as blocking.
- **Branch protection:** `main` is governed by GitHub **rulesets** — every change lands via a PR whose up-to-date `verify` check passes; contributor PRs also require a code-owner (maintainer) review; the repo owner can self-merge their own PR once CI is green. New pushes dismiss stale approvals, review conversations must be resolved, and AI-review availability is not a merge gate. No direct pushes, force-pushes, or deletion of `main`. **Squash-merge only.**
- **App code:** push to `main` → Vercel builds and deploys automatically. Primary domain `https://sailing-performance.vercel.app`.
- **Database:** the **Supabase GitHub integration** is connected to this repo with *Deploy to production* enabled on `main`. Supabase applies any new `supabase/migrations/` file automatically when it merges to `main` — no CI secrets, no manual step. (Locally you can still run `npm run db:push` to apply immediately.) Migrations must be **additive/backward-compatible** so app and schema can deploy in either order. After changing schema, run `npm run db:types` and commit the regenerated types. See `supabase/AGENTS.md`.

## Pull request flow

1. Get the fast local checks green — `npm run lint`, `npm run typecheck`, and the `npm run test` cases relevant to your change. In Codex, **do not run `npm run build` locally**; a clean local production build is not required because CI runs it (see above).
2. Open every PR against `main` as **Ready for review**, not as a draft. Create a draft only when the user explicitly requests one. Immediately after opening the ready PR, post `@codex review` in the PR conversation to request a Codex code review. GitHub Copilot and Claude (`.github/workflows/claude-review.yml`) also run automatic advisory reviews on ready PRs; they do not run on drafts or automatically re-review every push. Address or explain material findings and resolve their review conversations. Reviewer errors or exhausted quotas do not block merging.
3. CI runs dependency review and `npm run verify`; fix anything it flags that's attributable to your change. Keep changes additive/backward-compatible where they touch the database or shared analytics types.
4. `main`'s rulesets enforce the gate: the branch must be current with `main`, `verify` must pass, conversations must be resolved, and contributor PRs require a code-owner review of the final push. The repo owner can self-merge their own PR once CI is green. Squash-merge only — never force-push or push directly to `main`.

> **Owner merging your own PR:** the plain `gh pr merge` balks — it reads the global "review required" status and ignores your ruleset bypass. Merge via the GitHub **Merge** button or `gh pr merge <N> --squash --admin` (the server honors your bypass, so this isn't a real admin override).

## Security must-dos (every endpoint and query)

- **RLS on every table**, scoped with the `(select auth.uid())` idiom. New tables follow the pattern in `supabase/migrations`.
- **Anonymous access is server-mediated only.** There are no anon RLS policies; public share pages resolve via the admin client after a slug lookup. Do not add anon policies.
- **The admin (service-role) client bypasses RLS** — every call site must do its own authorization check first (membership, organizer, or admin).
- **Post-auth redirects** go through `getSafeNextPath` (`src/lib/auth/redirect.ts`) — an open-redirect guard.

## Cursor Cloud specific instructions

Unlike the Codex Cloud notes above (which target a remote hosted Supabase and skip `build`), the Cursor Cloud VM runs a **self-contained local Supabase stack in Docker**, so no production secrets are needed. Standard commands live in `README.md` / `CLAUDE.md` / `package.json`; this section only covers the non-obvious VM specifics.

**Node**: Node 24 (nvm) is the default. `~/.bashrc` prepends the nvm node-24 bin ahead of `/exec-daemon/node` (which is v22) so login/agent shells resolve Node 24. The startup update script only runs `npm ci`.

**Bringing services up in a fresh session** (nothing auto-starts these):
1. Docker is installed but `dockerd` may not be running — check `docker info`; if down, start it with `sudo dockerd > /tmp/dockerd.log 2>&1 &` and `sudo chmod 666 /var/run/docker.sock`.
2. `npx supabase start` — API at `http://127.0.0.1:54321`, Studio `:54323`, Mailpit (email) `http://localhost:54324`. Local stack data persists across `supabase stop`/`start`; only `supabase db reset` (or a first-ever start on an empty volume) re-runs migrations.
3. `npm run dev` — app at `http://localhost:3000`. `.env.local` (gitignored) already points at the local stack.

**GOTCHA — fresh DB init aborts on the admin-grant migration.** `supabase/migrations/20260712220000_grant_sailforever_admin.sql` fails on an empty DB because it requires the `sailforever@gmail.com` auth user to already exist, so a plain `supabase db reset` / first `supabase start` stops mid-migration. Bootstrap in two phases: (1) move every migration with a filename `>= 20260712220000` out of `supabase/migrations/`, run the reset/start (applies migrations 1–9), (2) create the user via the Auth admin API (`POST /auth/v1/admin/users` with the local secret key, `{"email":"sailforever@gmail.com","email_confirm":true}`), move the migrations back, then `npx supabase migration up`. Afterwards the working tree is unchanged. Prefer `supabase stop`/`start` over `db reset` to keep the bootstrapped state.

**GOTCHA — non-admin race creation fails locally.** `createRace` (`src/app/races/actions.ts`) does `INSERT ... RETURNING` via `.select()`; the races SELECT policy calls the STABLE `security definer` `is_race_member()`, which can't see the just-inserted row inside the same statement, so PostgREST reports `new row violates row-level security policy for table "races"`. Admin users bypass this because `is_race_organizer()` short-circuits on `is_admin()`. For end-to-end organizer flows (create race, upload tracks) sign in as an **admin** — `sailforever@gmail.com` is seeded as admin by the grant migration.

**Auth is passwordless magic link.** Sign in from `/login`, then open the newest **"Your sign-in link"** email in Mailpit (`http://localhost:54324`) and click its link — older "Confirm your email address" links expire and show "Email link is invalid or has expired".
