"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { createSeries } from "@/app/series/actions";
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

export function CreateSeriesDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createSeries(formData);
      } catch (caught) {
        if (caught instanceof Error && !caught.message.includes("NEXT_REDIRECT")) {
          setError(caught.message);
        }
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          New series
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a race series</DialogTitle>
          <DialogDescription>
            Add owned races, register canonical competitors, then confirm and apply scoring.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="series-name">Series name</Label>
            <Input id="series-name" name="name" placeholder="2026 Tuesday Night Series" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="series-venue">Venue (optional)</Label>
            <Input id="series-venue" name="venue" placeholder="Little Traverse Bay" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create series"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
