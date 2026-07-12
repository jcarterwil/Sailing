"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { claimBoatByCode } from "@/app/races/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ClaimForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await claimBoatByCode(code);
        setSuccess("Boat claimed. Redirecting to your dashboard…");
        setTimeout(() => router.push("/dashboard"), 800);
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
      <div className="space-y-2">
        <Label htmlFor="claim-code">Claim code</Label>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-500">{success}</p>}
      <Button type="submit" className="w-full" disabled={pending || !code.trim()}>
        {pending ? "Claiming…" : "Claim boat"}
      </Button>
    </form>
  );
}
