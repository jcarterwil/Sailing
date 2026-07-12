# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## ⚠️ Next.js 16 — not the Next.js in your training data

This repo runs **Next.js 16** (see `package.json`). Its APIs, conventions, and file layout differ from older versions. **Before writing framework code, read the relevant guide in `node_modules/next/dist/docs/`** and heed deprecation notices. The clearest example here is the request-interception layer: this project uses the **`proxy` convention (`src/proxy.ts`), which replaces the old `middleware.ts`** — same idea (runs before matched routes), new name and file.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build |
| `npm run verify` | **Pre-push gate:** lint → typecheck → build |
| `npm run db:push` | Apply pending migrations to the linked Supabase project |
| `npm run db:reset` | Reset the **local** Supabase database |
| `npx shadcn@latest add <name>` | Add a shadcn/ui component into `src/components/ui` |

- **Package manager:** npm; Node **22.x** (enforced via `engines`). Use `npm ci` for clean installs.
- **No test runner is configured yet** — `package.json` has no `test` script and there are no test files. Add a framework before writing tests; don't assume one exists.
- Path alias: `@/*` → `src/*` (`tsconfig.json`).

## Architecture

Next.js 16 App Router (`src/app`) + React 19 + TypeScript, Tailwind CSS 4, shadcn/ui (built on `radix-ui`), and Supabase (Auth + Postgres). Hosted on Vercel.

### Supabase clients — three variants, pick by execution context
This is the piece that requires reading several files to understand. All three read config through `src/lib/supabase/env.ts` (throws if the public env vars are missing) and use only the **publishable/anon key** — never a service-role key on the client.

- `src/lib/supabase/client.ts` — **browser** client, for Client Components (`"use client"`), e.g. the login form.
- `src/lib/supabase/server.ts` — **server** client, for Server Components and Route Handlers. Reads/writes cookies via `next/headers`; cookie writes from a Server Component are **silently swallowed** (RSCs can't set cookies) — session refresh is instead handled by the proxy.
- `src/lib/supabase/proxy.ts` (`updateSession`) — called from `src/proxy.ts` on every non-static request. It calls `supabase.auth.getClaims()` to **refresh the auth cookie**, which is what keeps server-side sessions alive. The `matcher` in `src/proxy.ts` excludes static assets and images.

### Auth flow
Passwordless **email magic link / OTP** is the primary path; **Google OAuth** is coded but feature-gated behind `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"` (both the login button and the callback exist; just flip the flag + configure the provider in Supabase to enable).

- `src/app/login/login-form.tsx` — `signInWithOtp` (magic link) and `signInWithOAuth` (Google), redirecting to `/auth/callback?next=/dashboard`.
- `src/app/auth/callback/route.ts` — OAuth/PKCE: `exchangeCodeForSession(code)`.
- `src/app/auth/confirm/route.ts` — email OTP: `verifyOtp({ token_hash, type })`.
- `src/app/auth/auth-code-error/page.tsx` — failure landing page.
- **Every post-auth redirect must go through `getSafeNextPath` (`src/lib/auth/redirect.ts`)** — it rejects `next` values that aren't same-origin relative paths (open-redirect guard) and defaults to `/dashboard`. Auth redirects are also wrapped in `setPrivateNoStore` to prevent caching.
- Route protection: Server Components verify the user with `supabase.auth.getUser()` and `redirect("/login")` when absent (see `src/app/dashboard/page.tsx`). Use `getUser()` (server-verified) for gating, not just the cookie.

### Database & RLS
Migrations live in `supabase/migrations` (declarative diffing via pgdelta, Postgres 17 — see `supabase/config.toml`). The initial migration creates `public.profiles` with **row-level security** (racers can only read/update their own row; `auth.uid()` is wrapped in a subselect for RLS performance). A `handle_new_user` trigger (`security definer`, empty `search_path`) auto-inserts a profile whenever an `auth.users` row is created. Follow these same patterns (RLS on, scoped policies) for new tables.

## Infrastructure & tooling access

- **Supabase project:** ref `mmyogyxvgwfmrqjcsguz` (name `sailing`), region `us-east-1`, Postgres 17. Created via the **Vercel–Supabase integration**, so it lives under a Vercel-managed org (`vercel_icfg_…`).
 - Use the **Supabase CLI** for DB work — it's logged in and this project is **linked** (`npm run db:push`, `db:reset`, `npx supabase ...`).
 - **Migrations auto-apply on merge to `main`** via the **Supabase GitHub Integration** (Deploy to production) and/or `.github/workflows/supabase-migrations.yml` (`db push`; skips if Actions secrets are unset). Vercel only syncs env vars; it does not run SQL. Details in `supabase/AGENTS.md`.
 - **The Supabase MCP does NOT see this project** — its token is scoped to a different org (it only lists `HealthSpan`). Don't rely on the Supabase MCP for sailing; use the CLI or the Supabase dashboard.
- **Vercel project:** `sailing` (`prj_rZgwrmSB1ANVNWDGtHlJKYKIXosT`) under team `carter-williams-projects` (`team_x318gGLYyqJt2rGWkApPx4GA`). Production: https://sailing-performance.vercel.app. Both the **Vercel CLI** (`jcarterwil`) and the **Vercel MCP** work and see this project. Deployment is GitHub-connected (push to the production branch); `vercel deploy --prod` also works locally.

### Environment variables
Only `NEXT_PUBLIC_`-prefixed values are used (all client-safe): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, and the `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` flag (`.env.example`). Pull real values with `npx vercel env pull .env.local`. **Never put a service-role/secret key in a `NEXT_PUBLIC_` variable.** Codex Cloud is intentionally kept free of production mutation/deploy credentials (`docs/codex-cloud-environment.md`).
