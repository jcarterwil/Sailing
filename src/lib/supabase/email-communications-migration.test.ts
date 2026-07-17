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

  it("cannot downgrade a webhook state when provider acceptance is recorded", () => {
    expect(migration).toContain(
      "create function public.record_email_provider_acceptance",
    );
    expect(migration).toContain(
      "status = case when last_event_at is null then 'sent' else status end",
    );
    expect(migration).toContain(
      "error_message = case when last_event_at is null then null else error_message end",
    );
    expect(migration).toContain(
      "revoke all on function public.record_email_provider_acceptance",
    );
  });

  it("atomically re-checks current preferences while claiming retries", () => {
    expect(migration).toContain("create function public.claim_email_retry_messages");
    expect(migration).toContain("returns jsonb");
    expect(migration).toContain("status = 'sending'");
    expect(migration).toContain("from public.notification_preferences np");
    expect(migration).toContain("not np.email_enabled");
    expect(migration).toContain("np.suppressed_at is not null");
    expect(migration).toContain("and not np.admin_announcements");
    expect(migration).toContain("and not np.boat_activity");
    expect(migration).toContain("and not np.report_ready");
    expect(migration).toContain(
      "revoke all on function public.claim_email_retry_messages(uuid[])",
    );
  });

  it("refreshes broadcast acceptance totals after retries through a service-only function", () => {
    expect(migration).toContain("create function public.refresh_email_broadcast");
    expect(migration).toContain(
      "count(*) filter (where provider_email_id is not null)::integer",
    );
    expect(migration).toContain("sent_count = v_accepted_count");
    expect(migration).toContain("failed_count = v_failed_count");
    expect(migration).toContain(
      "revoke all on function public.refresh_email_broadcast(uuid)",
    );
  });
});
