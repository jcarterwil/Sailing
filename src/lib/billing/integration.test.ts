import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("billing integration boundaries", () => {
  it("keeps billing writes server-mediated and reserves split funding atomically", () => {
    const migration = source(
      "supabase/migrations/20260717160000_billing_subscriptions.sql",
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
    }
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("create function public.reserve_club_checkout");
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
    expect(checkout).toContain("trial_period_days: settings.trialDays");
    expect(checkout).toContain("/api/billing/checkout/cancel?reservation=");
  });

  it("verifies Stripe signatures against the raw body and is retry-safe", () => {
    const webhook = source("src/app/api/webhooks/stripe/route.ts");
    expect(webhook).toContain("await request.text()");
    expect(webhook).toContain("webhooks.constructEvent");
    expect(webhook).toContain("billing_webhook_receipts");
    expect(webhook).toContain("Stripe's retry");
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
