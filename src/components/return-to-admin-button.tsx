"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { stopImpersonation } from "@/app/admin/users/impersonation-actions";
import { Button } from "@/components/ui/button";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ReturnToAdminButton({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(
      () => setRemaining(formatRemaining(expiresAt - Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <form action={stopImpersonation} className="inline-flex items-center gap-2">
      {remaining ? (
        <span className="tabular-nums text-xs opacity-80">{remaining} left</span>
      ) : null}
      <Button type="submit" size="xs" variant="outline">
        <LogOut className="size-3.5" aria-hidden="true" />
        Return to admin
      </Button>
    </form>
  );
}
