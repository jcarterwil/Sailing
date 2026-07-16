"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";

import { clearEmailSuppression } from "@/app/admin/email/actions";
import { Button } from "@/components/ui/button";

export function EmailClearSuppression({
  userId,
  memberLabel,
}: {
  userId: string;
  memberLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Clear Sailing's local suppression for ${memberLabel}? Do this only after resolving the complaint or suppression in Resend.`,
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            try {
              await clearEmailSuppression(userId);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not clear suppression.");
            }
          });
        }}
      >
        <ShieldCheck className="size-4" aria-hidden="true" />
        {pending ? "Clearing…" : "Clear local suppression"}
      </Button>
      {error ? <span className="max-w-64 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
