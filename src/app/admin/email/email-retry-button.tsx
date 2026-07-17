"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { retryEmailMessage } from "@/app/admin/email/actions";
import { Button } from "@/components/ui/button";

export function EmailRetryButton({ messageId }: { messageId: string }) {
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
          setError(null);
          startTransition(async () => {
            try {
              await retryEmailMessage(messageId);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Retry failed.");
            }
          });
        }}
      >
        <RotateCcw className={pending ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {error ? <span className="max-w-56 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
