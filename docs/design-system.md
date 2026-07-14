# Design system

The app's UI is driven by a small set of **centralized design tokens** so the
whole look can be re-skinned in one place, and mirrored to a **Claude design**
project so the design can be browsed and iterated visually.

## Where the tokens live (source of truth)

All color, radius, and font tokens are defined in **`src/app/globals.css`**:

- `@theme inline` maps each Tailwind utility (`bg-primary`, `text-muted-foreground`, …) to a CSS variable.
- `:root` holds the **light** values; `.dark` holds the **dark** values. Both are real — the theme is user-toggleable via `next-themes` (see `src/components/theme-provider.tsx` + `theme-toggle.tsx`).
- The palette is nautical: an ocean-blue `--primary`, cool-tinted neutrals, and a semantic `--chart-1..5` data-viz ramp. The body wash reads from `--brand`/`--brand-deep`.

Re-skinning the app = editing those ~35 variables. Nothing else needs to change.

## Shared shell

Layout is componentized so pages stay consistent:

- `src/components/layout/page-shell.tsx` — one container-width scale (`narrow` / `prose` / `default` / `wide`).
- `src/components/layout/page-header.tsx` — title / description / actions / back link.
- `src/components/layout/app-nav.tsx` — persistent authenticated top nav.
- Admin has its own gated shell (`src/app/admin/layout.tsx` + `admin-nav.tsx`).

## The Claude design project (`/design-sync`)

`design-system/` holds **HTML preview cards** that mirror the tokens and
components. Each card starts with a `<!-- @dsCard group="…" -->` marker; the
Claude Design pane groups cards by that label.

To create/update the claude.ai design-system project from these files:

1. Run the **`/design-sync`** skill. The first `DesignSync` call prompts you to
   grant design-system access on your claude.ai login.
2. It creates (or updates) a design-system project and syncs the cards under
   `design-system/` one component at a time.
3. Iterate on the design in the Claude Design pane; pull changes back into the
   tokens/components here. Keep the two in step — `globals.css` stays the source
   of truth for what actually ships.

### Adding a card

Drop an HTML file under `design-system/<group>/<name>.html` whose first line is
`<!-- @dsCard group="Foundations" -->` (or `Components`, `Layout`, …). Make it
self-contained (inline the token values you're showing) so it renders on its own
in the design pane, then re-run `/design-sync`.

Current cards:

- `foundations/colors.html` — the nautical palette (light + dark, incl. chart ramp).

Grow this to cover typography, spacing/radius, and the key components (button,
badge, input/select, card, table, `PageShell`/`PageHeader`, `AppNav`, the admin
sidebar, and the boat-hub layout).
