"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function openStripe(path: string, body?: object) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !result.url) throw new Error(result.error ?? "Could not open Stripe.");
  window.location.assign(result.url);
}

export function UserCheckoutButton({ trialDays }: { trialDays: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="min-h-11 w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await openStripe("/api/billing/checkout", { kind: "user" });
            } catch (checkoutError) {
              setError(checkoutError instanceof Error ? checkoutError.message : "Checkout failed.");
            }
          })
        }
      >
        {pending ? "Opening Stripe…" : `Start ${trialDays}-day trial`}
      </Button>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export function ClubContributionButton({
  raceId,
  remainingCents,
  trialDays,
}: {
  raceId: string;
  remainingCents: number;
  trialDays: number;
}) {
  const suggested = Math.min(remainingCents, 2_500) / 100;
  const [amount, setAmount] = useState(String(suggested));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Label htmlFor={`club-contribution-${raceId}`}>Your annual portion (USD)</Label>
      <div className="flex gap-2">
        <Input
          id={`club-contribution-${raceId}`}
          type="number"
          min={Math.min(5, remainingCents / 100)}
          max={remainingCents / 100}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="h-11"
        />
        <Button
          type="button"
          className="min-h-11"
          disabled={pending || remainingCents <= 0}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                const cents = Math.round(Number(amount) * 100);
                if (!Number.isFinite(cents) || cents <= 0) {
                  throw new Error("Enter a contribution greater than $0.");
                }
                await openStripe("/api/billing/checkout", {
                  kind: "club",
                  raceId,
                  amountCents: cents,
                });
              } catch (checkoutError) {
                setError(
                  checkoutError instanceof Error ? checkoutError.message : "Checkout failed.",
                );
              }
            })
          }
        >
          {pending ? "Opening…" : `Start ${trialDays}-day trial`}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Recurs yearly. Other racers can cover the remaining balance separately.
      </p>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export function BillingPortalButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await openStripe("/api/billing/portal");
            } catch (portalError) {
              setError(portalError instanceof Error ? portalError.message : "Billing failed.");
            }
          })
        }
      >
        {pending ? "Opening…" : "Manage Stripe billing"}
      </Button>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
