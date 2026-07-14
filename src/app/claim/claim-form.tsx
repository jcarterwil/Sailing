"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { claimBoatByCode } from "@/app/races/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface OwnerInvitationSummary {
  boatName: string;
  sailNumber: string | null;
  boatClass: string | null;
  currentOwnerName: string | null;
  isTransfer: boolean;
}

export function ClaimForm({
  initialCode,
  invitation,
  accountEmail,
  invalidInvitation,
}: {
  initialCode: string;
  invitation: OwnerInvitationSummary | null;
  accountEmail: string;
  invalidInvitation: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  function submit() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await claimBoatByCode(code);
        setSuccess(
          result.transferred
            ? "Ownership transferred. Opening the boat…"
            : "Ownership accepted. Opening the boat…",
        );
        redirectTimer.current = setTimeout(() => router.push(`/boats/${result.boatId}`), 600);
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-border/70 bg-card/70 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {invitation ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{invitation.boatName}</p>
              <p className="text-sm text-muted-foreground">
                {[invitation.boatClass, invitation.sailNumber && `Sail ${invitation.sailNumber}`]
                  .filter(Boolean)
                  .join(" · ") || "Boat ownership invitation"}
              </p>
            </div>
            <Badge variant="secondary">
              {invitation.isTransfer ? "Ownership transfer" : "New owner"}
            </Badge>
          </div>
          {invitation.isTransfer && (
            <p className="text-sm text-muted-foreground">
              The current owner
              {invitation.currentOwnerName ? `, ${invitation.currentOwnerName},` : ""} keeps access
              until you accept.
            </p>
          )}
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            Accepting will make <strong>{accountEmail}</strong> the boat owner. Owners manage boat
            settings and crew access.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="claim-code">Owner invitation code</Label>
          <Input
            id="claim-code"
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD1234"
          />
        </div>
      )}
      {invalidInvitation && code === initialCode && !error && (
        <Alert variant="destructive">
          <AlertTitle>Invitation unavailable</AlertTitle>
          <AlertDescription>
            This link is invalid, expired, or already used. Enter another code or ask the organizer
            for a new link.
          </AlertDescription>
        </Alert>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-500">{success}</p>}
      <Button type="submit" className="w-full" disabled={pending || !code.trim()}>
        {pending ? "Accepting…" : invitation ? "Accept ownership" : "Claim boat"}
      </Button>
      <Button type="button" variant="ghost" className="w-full" asChild>
        <Link href="/dashboard">Cancel</Link>
      </Button>
    </form>
  );
}
