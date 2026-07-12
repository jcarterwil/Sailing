# Supabase — agent guide

Postgres 17 + Auth + Storage. Schema lives in `migrations/*.sql`; project config in `config.toml`. The Supabase MCP does **not** see this project (its token is scoped to a different org) — use the CLI.

## How a schema change ships (the migration workflow)

1. Add a new timestamped file in `migrations/` (e.g. `20260712180000_add_thing.sql`). Never edit an already-applied migration — append a new one.
2. Merge it to `main`. The **Supabase GitHub integration** (Project → Settings → Integrations → GitHub, *Deploy to production* enabled on `main`) applies it automatically — no CI secrets or manual step. To apply immediately from a local checkout instead, run `npm run db:push`.
3. Regenerate types: `npm run db:types`, and **commit the updated `src/lib/supabase/database.types.ts`** in the same PR.
4. Keep migrations **additive / backward-compatible** (add tables/columns/policies; avoid dropping or renaming things the deployed app still reads). App code and schema can deploy in either order, seconds apart — a non-additive change will break the running app during that window.

Project ref: `mmyogyxvgwfmrqjcsguz`. From a fresh machine: `npx supabase login` then `npx supabase link --project-ref mmyogyxvgwfmrqjcsguz`.

## RLS idioms (follow these on every new table)

```sql
alter table public.thing enable row level security;
revoke all on table public.thing from anon;                 -- no anonymous access
grant select, insert, update on table public.thing to authenticated;

create policy "..." on public.thing
  for select to authenticated
  using ((select auth.uid()) = owner_id);                   -- subselect form (RLS perf)
```

- **Wrap `auth.uid()` in a subselect** — `(select auth.uid())` — so Postgres caches it per statement.
- **Cross-table membership checks go through `security definer` helpers** (`is_race_member`, `is_race_organizer`, `is_admin`) to avoid recursive-policy evaluation. Helpers use `security definer set search_path = ''`.
- **Admins** (`profiles.is_admin`) get organizer power everywhere via `is_race_organizer`. Grant admin by updating the column with the service role; there is no self-service path.
- **Server-written tables** (`race_analyses`, `race_reports`) have `select`-only policies for members — writes happen only through the admin client in route handlers.

## Storage

Two private buckets: `race-tracks-raw` and `race-tracks-processed`. **No `storage.objects` policies exist** (default-deny). All reads/writes go through server-minted signed URLs (`createSignedUploadUrl` / `createSignedUrl`) after an app-level authorization check. Don't add storage policies — that would open a bypass around the membership checks.
