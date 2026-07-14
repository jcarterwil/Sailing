"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { createOwnedBoat } from "@/app/boats/boat-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY_FORM = { name: "", sailNumber: "", boatClass: "" };

export function CreateBoatDialog({ existingNames }: { existingNames: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const duplicateName = useMemo(() => {
    const normalized = form.name.trim().toLocaleLowerCase();
    return normalized
      ? existingNames.some((name) => name.trim().toLocaleLowerCase() === normalized)
      : false;
  }, [existingNames, form.name]);

  function reset() {
    setForm(EMPTY_FORM);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createOwnedBoat(form);
        reset();
        setOpen(false);
        router.push(`/boats/${result.boatId}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the boat.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="min-h-11">
          <Plus className="size-4" aria-hidden="true" />
          Add boat
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add your boat</DialogTitle>
          <DialogDescription>
            Create one durable boat identity to reuse for every race and practice.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-boat-name">Boat name</Label>
            <Input
              id="new-boat-name"
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Rock Steady"
            />
            {duplicateName ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                You already own a boat with this name. Create another only if it is a different
                physical boat.
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-boat-sail">Sail number (optional)</Label>
              <Input
                id="new-boat-sail"
                maxLength={80}
                value={form.sailNumber}
                onChange={(event) => setForm({ ...form, sailNumber: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-boat-class">Class (optional)</Label>
              <Input
                id="new-boat-class"
                maxLength={80}
                value={form.boatClass}
                onChange={(event) => setForm({ ...form, boatClass: event.target.value })}
              />
            </div>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" className="min-h-11" disabled={pending}>
              {pending ? "Creating…" : "Create boat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
