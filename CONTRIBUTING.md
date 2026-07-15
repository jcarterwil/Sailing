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

Requires **Node 24.x** and npm.

```bash
npm ci            # clean install
npm run dev       # dev server at http://localhost:3000
```

You'll need Supabase public env vars to run the app locally — copy
`.env.example` to `.env.local` and fill in the `NEXT_PUBLIC_*` values. Never put
a secret in a `NEXT_PUBLIC_` variable.

## Before you open a PR

Run the fast local checks that apply to your change:

```bash
npm run lint
npm run typecheck
npm run test      # or the relevant targeted Vitest cases
```

Do not require a local production build. GitHub CI owns the full
`npm run verify` gate (lint → typecheck → test → build) on a clean runner.

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
2. Make your change and run the fast local checks above.
3. Open the PR against `main` and fill in the template. Use a draft while work
   is in progress; automated reviewers are requested only after the PR is ready.
4. Codex and GitHub Copilot each provide one advisory review when the PR is
   opened for review or a draft is marked ready. Address or explain material
   findings and resolve the associated review conversations. A reviewer outage
   or exhausted quota does not block the PR.
5. GitHub CI must pass `verify`, including dependency review and the production
   build. First-time fork contributors may need a maintainer to approve the
   workflow run before CI starts.
6. The code owner reviews the final diff after the contributor's last push, then
   squash-merges the PR. New commits dismiss an earlier approval.

Maintainer-authored PRs cannot be self-approved on GitHub. The repository owner
self-reviews, waits for `verify`, and may then squash-merge using the configured
review-rule bypass; the CI gate remains mandatory.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
