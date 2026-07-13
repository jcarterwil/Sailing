# Contributing to Sailing

Thanks for your interest! This is a sailing race-performance app (Next.js 16 +
React 19 + TypeScript + Supabase). Issues and pull requests are welcome.

## Ways to help

- **Report a bug or request a feature** — open an issue using one of the
  templates. For security problems, do **not** open a public issue; see
  [SECURITY.md](./SECURITY.md).
- **Send a pull request** — for anything non-trivial, please open (or comment
  on) an issue first so we can agree on the approach before you invest time.

## Development setup

Requires **Node 22.x** and npm.

```bash
npm ci            # clean install
npm run dev       # dev server at http://localhost:3000
```

You'll need Supabase public env vars to run the app locally — copy
`.env.example` to `.env.local` and fill in the `NEXT_PUBLIC_*` values. Never put
a secret in a `NEXT_PUBLIC_` variable.

## Before you open a PR

Run the full gate and make sure it passes — CI runs the same thing:

```bash
npm run verify    # lint -> typecheck -> test -> build
```

- Keep changes **surgical**: match the surrounding style, and touch only what
  the change needs. Don't refactor unrelated code in the same PR.
- Add tests for new behavior. Analytics logic lives in `src/lib/analytics` and
  is covered by Vitest golden/unit tests.
- Database migrations (`supabase/migrations`) must be **additive and
  backward-compatible** so the app and schema can deploy in either order. After
  a schema change, run `npm run db:types` and commit the regenerated types.
- Read the `AGENTS.md` nearest the code you're touching — directory-specific
  guides exist for analytics, replay, and Supabase.

## Pull request flow

1. Fork the repo (external contributors) or create a branch (collaborators).
2. Make your change and get `npm run verify` green.
3. Open the PR against `main` and fill in the template.
4. CI must pass and a maintainer must approve before merge. `main` is protected
   — nothing merges without review.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
