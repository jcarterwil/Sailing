import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("billing integration boundaries", () => {
  it("uses a unique Supabase migration version", () => {
    const migrations = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"));
    const versions = migrations.map((file) => file.split("_", 1)[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(migrations).toContain("20260717161000_billing_subscriptions.sql");
  });

  it("keeps billing writes server-mediated and reserves split funding atomically", () => {
    const migration = source(
      "supabase/migrations/20260717161000_billing_subscriptions.sql",
    ).toLowerCase();
    for (const table of [
      "billing_enrollments",
      "billing_customers",
      "billing_checkout_reservations",
      "billing_subscriptions",
      "billing_webhook_receipts",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from anon`);
      expect(migration).not.toMatch(
        new RegExp(`grant (?:insert|update|delete)[^;]*${table}[^;]*authenticated`),
      );
      expect(migration).toMatch(
        new RegExp(`revoke insert, update, delete on table public\\.${table} from authenticated`),
      );
    }
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("create function public.reserve_club_checkout");
    expect(migration).toContain("create function public.claim_billing_webhook_event");
    expect(migration).toContain("bm.user_id = payer");
    expect(migration).toContain("s.status in ('active', 'trialing')");
    const userReservation = migration.slice(
      migration.indexOf("create function public.reserve_user_checkout"),
      migration.indexOf("create function public.reserve_club_checkout"),
    );
    expect(userReservation).toContain("r.status = 'pending'");
    expect(userReservation).toContain("s.status in ('active', 'trialing')");
    expect(userReservation).not.toContain("status in ('pending', 'completed')");
    expect(migration).toContain("to service_role");
  });

  it("validates checkout origin and race membership before service-role work", () => {
    const checkout = source("src/app/api/billing/checkout/route.ts");
    expect(checkout).toContain("assertSameOrigin(request)");
    expect(checkout).toContain('.from("races")');
    expect(checkout).toContain('admin.rpc("reserve_club_checkout"');
    expect(checkout).toContain('mode: "subscription"');
    expect(checkout).toContain('payment_method_collection: "always"');
    expect(checkout).toContain('payment_method_types: ["card"]');
    expect(checkout).toContain("settings.trialDays > 0");
    expect(checkout).toContain("trial_period_days: settings.trialDays");
    expect(checkout).toContain("/api/billing/checkout/cancel?reservation=");
  });

  it("verifies Stripe signatures against the raw body and is retry-safe", () => {
    const webhook = source("src/app/api/webhooks/stripe/route.ts");
    expect(webhook).toContain("await request.text()");
    expect(webhook).toContain("webhooks.constructEvent");
    expect(webhook).toContain("billing_webhook_receipts");
    expect(webhook).toContain("claim_billing_webhook_event");
    expect(webhook).toContain("subscriptions.retrieve");
    expect(webhook).toContain('status: "processed"');
  });

  it("fails closed without 500s during the migration deployment window", () => {
    const server = source("src/lib/billing/server.ts");
    expect(server).toContain('error?.code === "42P01"');
    expect(server).toContain('error?.code === "PGRST205"');
    expect(server).toContain("allowed: false");
    expect(server).toContain("hasStripeBillingCustomer");
    expect(server).toContain('.eq("status", "pending")');
    expect(server).toContain('.gt("expires_at"');
  });

  it("uses a first-writer-wins Stripe customer mapping", () => {
    const stripe = source("src/lib/billing/stripe.ts");
    expect(stripe).toContain('.insert({ user_id: input.userId');
    expect(stripe).toContain('saveError.code !== "23505"');
    expect(stripe).toContain("customers.del(customer.id)");
    expect(stripe).not.toContain(".upsert(");
  });

  it("gates shared race AI and personal boat AI independently", () => {
    const report = source("src/app/api/races/[raceId]/report/route.ts");
    const coach = source(
      "src/app/api/boats/[boatId]/performance-history/coach/route.ts",
    );
    expect(report).toContain("hasClubAiEntitlement");
    expect(coach).toContain("hasUserAiEntitlement");
    expect(coach).toContain("402");
  });
});
