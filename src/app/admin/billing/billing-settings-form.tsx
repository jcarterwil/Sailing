"use client";

import { useState, useTransition } from "react";

import { updatePaymentsEnabled } from "@/app/admin/billing/actions";
import { Button } from "@/components/ui/button";

export function BillingSettingsForm({
  enabled,
  canEnable,
}: {
  enabled: boolean;
  canEnable: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = !enabled;
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant={enabled ? "outline" : "default"}
        disabled={pending || (next && !canEnable)}
        onClick={() => {
          if (
            next &&
            !window.confirm(
              "Enable Stripe payments? Existing early-access AI plans will require a card-backed 30-day trial to continue.",
            )
          ) return;
          startTransition(async () => {
            setError(null);
            try {
              await updatePaymentsEnabled(next);
            } catch (actionError) {
              setError(actionError instanceof Error ? actionError.message : "Update failed.");
            }
          });
        }}
      >
        {pending ? "Updating…" : enabled ? "Disable new checkouts" : "Enable Stripe payments"}
      </Button>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
