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
- Node.js 22

## Local setup

Requirements: Node.js 22 and npm.

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

### CI (auto-migrate on merge)

Merging a PR that changes `supabase/migrations/**` runs
[`.github/workflows/supabase-migrate.yml`](.github/workflows/supabase-migrate.yml)
on `main` and applies pending migrations with `supabase db push`.

Required repository secrets (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database (database password) |

You can also run the workflow manually via Actions → Supabase Migrate → Run workflow.

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
| `npm run build` | Create a production build |
| `npm run verify` | Run lint, typecheck, and production build |
| `npm run db:push` | Apply pending Supabase migrations |
| `npm run db:reset` | Reset a local Supabase database |

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
