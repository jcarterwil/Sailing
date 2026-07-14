"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateBoatDetails } from "@/app/boats/boat-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BoatSettingsForm({
  boatId,
  name,
  sailNumber,
  boatClass,
}: {
  boatId: string;
  name: string;
  sailNumber: string | null;
  boatClass: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name,
    sailNumber: sailNumber ?? "",
    boatClass: boatClass ?? "",
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateBoatDetails({ boatId, ...form });
          if (result.error) toast.error(result.error);
          else toast.success("Boat updated.");
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="boat-name">Name</Label>
        <Input
          id="boat-name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="boat-sail">Sail number</Label>
        <Input
          id="boat-sail"
          value={form.sailNumber}
          onChange={(event) => setForm({ ...form, sailNumber: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="boat-class">Class</Label>
        <Input
          id="boat-class"
          value={form.boatClass}
          onChange={(event) => setForm({ ...form, boatClass: event.target.value })}
        />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
