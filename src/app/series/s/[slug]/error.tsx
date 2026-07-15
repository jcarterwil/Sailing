"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function SharedSeriesReportError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="size-9 text-amber-600" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Could not open the shared series report</h1>
      <p className="text-sm text-muted-foreground">
        No partial standings were shown. The link may have changed, or the validated report may be temporarily unavailable.
      </p>
      <Button type="button" onClick={reset}>Try again</Button>
    </main>
  );
}
