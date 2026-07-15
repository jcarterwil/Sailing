"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { createSession } from "@/app/races/actions";
import { BoatSelect } from "@/components/boats/boat-select";
import { HelpTip } from "@/components/help/help-tip";
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
import type { EditableBoatOption } from "@/lib/boats/active-boats";
import type { SessionType } from "@/lib/sessions/types";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function defaultLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function defaultLocalTime(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function CreateSessionDialog({
  boats,
}: {
  boats: EditableBoatOption[];
}) {
  const [open, setOpen] = useState(false);
  const [sessionType, setSessionType] = useState<SessionType>("race");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [boatId, setBoatId] = useState(() => boats[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedBoatId = boatId || boats[0]?.id || "";

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("session_type", sessionType);
    formData.set("timezone", timezone);
    if (sessionType === "practice") {
      formData.set("boat_id", selectedBoatId);
    } else {
      formData.delete("boat_id");
    }
    startTransition(async () => {
      try {
        await createSession(formData);
      } catch (err) {
        // redirect() throws internally; only surface real failures.
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(90vh,40rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a session</DialogTitle>
          <DialogDescription>
            {sessionType === "practice"
              ? "Private single-boat practice with an actual date and timezone."
              : "Organize a race: upload fleet tracks, share a join code, and publish reports."}
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <fieldset className="space-y-2">
            <Legend>
              <span className="inline-flex items-center gap-1">
                Session type
                <HelpTip termKey="sessionType" />
              </span>
            </Legend>
            <div className="grid grid-cols-2 gap-2">
              <TypeButton
                active={sessionType === "race"}
                onClick={() => setSessionType("race")}
                label="Race"
                description="Fleet / join code"
              />
              <TypeButton
                active={sessionType === "practice"}
                onClick={() => setSessionType("practice")}
                label="Practice"
                description="One boat, private"
              />
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="session-name">Session name</Label>
            <Input
              id="session-name"
              name="name"
              placeholder={
                sessionType === "practice" ? "Tuesday evening practice" : "Tuesday Night Race"
              }
              required
              maxLength={200}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="session-date">Local date</Label>
              <Input
                id="session-date"
                name="local_date"
                type="date"
                required
                defaultValue={defaultLocalDate()}
                className="min-h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-time">Local time</Label>
              <Input
                id="session-time"
                name="local_time"
                type="time"
                required
                defaultValue={defaultLocalTime()}
                className="min-h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="session-timezone">Timezone (IANA)</Label>
              <HelpTip termKey="timezone" />
            </div>
            <Input
              id="session-timezone"
              name="timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="America/Detroit"
              required
              maxLength={100}
              className="min-h-11"
            />
            <p className="text-xs text-muted-foreground">
              Suggested from this browser; edit if the session was elsewhere. Ambiguous DST times
              are rejected.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="session-venue">Venue (optional)</Label>
            <Input id="session-venue" name="venue" placeholder="Little Traverse Bay" />
          </div>

          {sessionType === "practice" ? (
            <div className="space-y-2">
              <Label>Boat</Label>
              {boats.length > 0 ? (
                <BoatSelect
                  boats={boats}
                  value={selectedBoatId}
                  onValueChange={setBoatId}
                  ariaLabel="Practice boat"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Claim or create a boat you own or can edit before starting a practice.
                </p>
              )}
            </div>
          ) : null}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                pending ||
                (sessionType === "practice" && (!selectedBoatId || boats.length === 0))
              }
              className="min-h-11"
            >
              {pending
                ? "Creating…"
                : sessionType === "practice"
                  ? "Create practice"
                  : "Create race"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return <legend className="text-sm font-medium">{children}</legend>;
}

function TypeButton({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left"
          : "min-h-11 rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-left"
      }
      aria-pressed={active}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

/** @deprecated Prefer CreateSessionDialog. */
export { CreateSessionDialog as CreateRaceDialog };
