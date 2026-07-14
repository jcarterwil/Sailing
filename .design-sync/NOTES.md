# design-sync notes — Sailing

- **Repo shape: off-script.** Sailing is a private Next.js *app*, not a
  component-library or Storybook repo — there is no bundlable `dist/`, so the
  high-fidelity converter path does not apply. The design system is authored as
  self-contained `@dsCard` HTML preview cards under `design-system/`, mirroring
  the token source of truth in `src/app/globals.css` (see `docs/design-system.md`).
- Cards are **visual reference** (inline styles reproducing the real shadcn /
  nautical look), not bound compiled components — the design agent references
  them for on-brand designs but cannot import a real component bundle.
- To extend: add an `@dsCard`-marked HTML file under `design-system/`, then
  re-run `/design-sync`.
- Project: **Sailing Performance** — https://claude.ai/design/p/d3b73fec-6991-4c07-8e88-7a430d74f1aa
