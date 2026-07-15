"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SeriesPrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" />
      Print / PDF
    </Button>
  );
}
