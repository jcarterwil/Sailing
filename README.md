# Sailing

Sailing is a club-racing application for comparing sailboat performance and giving racers a secure place to access race data. The current release is the production-ready foundation for boat data, comparisons, fleets, regattas, and collegiate racing.

Production: https://sailing-performance.vercel.app

## What works now

- Responsive sailing-focused landing page
- Passwordless email sign-in through Supabase Auth
- Protected racer dashboard and sign-out flow
- Server-side session refresh using the Next.js 16 proxy convention
- Racer profile table with row-level security
- Vercel deployment linked to `jcarterwil/Sailing`
- Supabase project, database migration, and Vercel environment integration
- Google OAuth UI and callback code, feature-gated until Google credentials are installed
- Codex Cloud setup and maintenance scripts

## Stack

- Next.js 16 App Router with React 19 and TypeScript
- Tailwind CSS 4 and shadcn/ui
- Supabase Auth and Postgres
- Vercel hosting and GitHub deployments
- Node.js 24 (Active LTS)

## Local setup

Requirements: Node.js 24 and npm.

```bash
git clone https://github.com/jcarterwil/Sailing.git
cd Sailing
npm ci
```

If you have access to the linked Vercel project, pull the development environment:

```bash
npx vercel link
npx vercel env pull .env.local
```

Otherwise, copy `.env.example` to `.env.local` and fill in the two public Supabase values. Never place a service-role key in a `NEXT_PUBLIC_` variable.

Start the app:

```bash
npm run dev
```

Open http://localhost:3000.

## Supabase

The initial migration creates `public.profiles`, enables row-level security, and creates a profile automatically when an Auth user is created.

To link and apply migrations from a new workstation:

```bash
npx supabase login
npx supabase link --project-ref mmyogyxvgwfmrqjcsguz
npm run db:push
```

### Auto-migrate on merge

Vercel only syncs env vars — it does **not** run SQL. Migrations under
`supabase/migrations/` are applied on merge to `main` automatically by the
**Supabase GitHub Integration** ([Project Settings → Integrations → GitHub](https://supabase.com/dashboard/project/mmyogyxvgwfmrqjcsguz/settings/integrations) with **Deploy to production** enabled). No CI secrets and no manual step — just merge. Locally you can apply immediately with `npm run db:push`. Keep migrations additive/backward-compatible, and run `npm run db:types` after a schema change (see `supabase/AGENTS.md`).

Hosted Auth is configured for localhost, Vercel preview deployments, and the production origin.

### Enable Google sign-in

Email sign-in is active now. To activate the Google button:

1. Create a Google OAuth 2.0 Web application.
2. Add this authorized redirect URI:
   `https://mmyogyxvgwfmrqjcsguz.supabase.co/auth/v1/callback`
3. In Supabase, open Authentication > Providers > Google and enter the client ID and secret.
4. Add `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` to the Vercel environments that should show the button.
5. Redeploy the app.

Do not commit the Google client secret.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm run test` | Run the Vitest suite |
| `npm run build` | Create a production build |
| `npm run verify` | Run lint → typecheck → test → build (what CI runs) |
| `npm run db:push` | Apply pending Supabase migrations |
| `npm run db:reset` | Reset a local Supabase database |

## Testing and CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs
dependency review plus `npm run verify` (lint → typecheck → test → build) on
every pull request, and `npm run verify` on push to `main`. **CI is the
authoritative build/test gate for Codex work** — locally run only the fast
checks (`lint`, `typecheck`, and the relevant `test`s). Do not run or require
`npm run build` locally; push and let GitHub run the full build/test on its
clean runner, then fix anything that `verify` reports.

Ready-for-review pull requests receive one advisory review each from Codex and
GitHub Copilot; drafts do not. Contributors address material findings and
resolve review conversations, but reviewer outages or exhausted quotas do not
block merging. The enforced gates remain `verify` and final maintainer review.

`main` is protected by GitHub rulesets: changes land through a PR whose
up-to-date `verify` check passes, contributor PRs also require a maintainer
review of the final push, and no one pushes to `main` directly. Review
conversations must be resolved and only squash merges are allowed. The repo
owner can self-merge once CI is green.

## Deployment

GitHub is connected to the Vercel project. Changes pushed to the configured production branch deploy through Vercel; local production deployment is also available with:

```bash
vercel deploy --prod
```

## Codex Cloud

See [docs/codex-cloud-environment.md](docs/codex-cloud-environment.md) for the exact environment settings and scripts. The repository intentionally keeps production database and deployment credentials out of the Codex Cloud agent environment.

## Project layout

- `src/app` — routes and UI
- `src/lib/supabase` — browser, server, and proxy Supabase clients
- `src/proxy.ts` — authenticated session refresh
- `supabase/migrations` — database schema history
- `scripts` — Codex Cloud setup and maintenance
- `docs` — operational setup notes
