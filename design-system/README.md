# Sailing Performance — design system

On-brand tokens and component patterns for the Sailing race-performance app
(Next.js + React + Tailwind 4 + shadcn/ui, "radix-nova" style). Nautical, calm,
data-dense. **Dark is the default theme; light is fully supported.**

Source of truth for the real tokens: `src/app/globals.css` (`:root` = light,
`.dark` = dark). These previews mirror it.

## Color tokens (use these names, not raw hex)

| Token | Role | Dark value | Light value |
|---|---|---|---|
| `background` | app ground | `oklch(0.17 0.02 250)` | `oklch(0.99 0.006 240)` |
| `foreground` | primary text | `oklch(0.96 0.01 240)` | `oklch(0.21 0.03 250)` |
| `card` | surface | `oklch(0.21 0.025 250)` | `oklch(1 0.004 240)` |
| `primary` | brand / CTAs | `oklch(0.64 0.14 240)` | `oklch(0.51 0.13 245)` |
| `primary-foreground` | text on primary | `oklch(0.16 0.03 250)` | `oklch(0.99 0.01 240)` |
| `secondary` / `muted` | quiet fills | `oklch(0.27 0.03 250)` | `oklch(0.96 0.012 240)` |
| `muted-foreground` | captions | `oklch(0.72 0.03 240)` | `oklch(0.52 0.03 245)` |
| `accent` | subtle highlight | `oklch(0.32 0.05 230)` | `oklch(0.93 0.03 220)` |
| `destructive` | danger | `oklch(0.704 0.191 22.216)` | `oklch(0.577 0.245 27.325)` |
| `border` | hairlines | `white / 10%` | `oklch(0.9 0.012 240)` |

**Data-viz ramp** `chart-1..5` (fleet boats, polars, instruments) — dark:
`oklch(0.64 0.14 245)` blue, `oklch(0.72 0.12 195)` teal, `oklch(0.78 0.14 85)`
gold, `oklch(0.68 0.17 25)` coral, `oklch(0.7 0.14 155)` sea-green.

## Idiom

- **Type:** Geist (sans + mono). Headings `font-semibold tracking-tight`.
- **Radius:** `--radius: 0.625rem`. Cards `rounded-xl`, buttons `rounded-lg`,
  badges are **pills** (`rounded-4xl`).
- **Buttons** are compact (default height `h-8`): `default` = solid primary
  blue, `outline`, `secondary`, `ghost`; `destructive` is a *soft tinted* style
  (`bg-destructive/10 text-destructive`), not a solid red block.
- **Cards** are `bg-card` with a `ring-1 ring-foreground/10` (not a hard border).
- **Feedback:** toasts (sonner), not inline banners, for transient success/error.

Style with Tailwind utilities bound to these token names (`bg-primary`,
`text-muted-foreground`, `ring-foreground/10`, `bg-card`), so a theme switch and
any re-skin flow automatically.
