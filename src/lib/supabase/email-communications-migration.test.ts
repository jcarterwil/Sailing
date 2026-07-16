import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717120000_email_communications.sql"),
  "utf8",
).toLowerCase();

const ledgerTables = ["email_broadcasts", "email_messages", "email_events"] as const;

describe("email communications migration", () => {
  it("creates a private admin ledger with an immutable webhook receipt ID", () => {
    for (const table of ledgerTables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from anon`);
      expect(migration).toContain(`grant select on table public.${table} to authenticated`);
      expect(migration).not.toMatch(
        new RegExp(`grant (?:insert|update|delete)[^;]*${table}[^;]*authenticated`),
      );
    }
    expect(migration).toContain("svix_id text not null unique");
    expect(migration).toContain("idempotency_key text not null");
    expect(migration).toContain("email_messages_idempotency_key_uidx");
  });

  it("lets members edit only preference fields, never provider suppression", () => {
    expect(migration).toContain("create table public.notification_preferences");
    expect(migration).toContain("suppressed_at timestamptz");
    expect(migration).toContain("grant update (\n  email_enabled,");
    expect(migration).not.toMatch(
      /grant update \([^)]*suppressed_at[^)]*\) on public\.notification_preferences/,
    );
    expect(migration).toContain("user_id = (select auth.uid())");
  });

  it("applies out-of-order delivery state atomically through a service-only function", () => {
    expect(migration).toContain("create function public.apply_email_delivery_event");
    expect(migration).toContain("last_event_at is null or last_event_at <= p_occurred_at");
    expect(migration).toContain(
      "revoke all on function public.apply_email_delivery_event",
    );
    expect(migration).toContain(") from public, anon, authenticated;");
    expect(migration).toContain(") to service_role;");
  });
});
