"use client";

import { useState, useTransition } from "react";

import { joinRace, type BoatSelection } from "@/app/races/actions";
import { BoatSelect } from "@/components/boats/boat-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EditableBoatOption } from "@/lib/boats/active-boats";

export function JoinRaceForm({ boats }: { boats: EditableBoatOption[] }) {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"existing" | "new">(boats.length > 0 ? "existing" : "new");
  const [boatId, setBoatId] = useState(boats[0]?.id ?? "");
  const [newBoat, setNewBoat] = useState({ name: "", sailNumber: "", boatClass: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const selection: BoatSelection =
      mode === "existing"
        ? { kind: "existing", boatId }
        : {
            kind: "new",
            name: newBoat.name,
            sailNumber: newBoat.sailNumber,
            boatClass: newBoat.boatClass,
          };

    startTransition(async () => {
      try {
        await joinRace({ code, selection });
      } catch (err) {
        // redirect() throws internally; surface only an actual failure.
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="join-code">Join code</Label>
        <Input
          id="join-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toLowerCase())}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          placeholder="e.g. 4f9b2c1a"
          required
        />
      </div>

      {mode === "existing" ? (
        <div className="space-y-3 rounded-lg border border-border/70 p-4">
          <div className="space-y-1">
            <Label>Enter one of your boats</Label>
            <p className="text-xs text-muted-foreground">
              Owners and editors can reuse the same boat identity in every race.
            </p>
          </div>
          <BoatSelect
            boats={boats}
            value={boatId}
            onValueChange={setBoatId}
            ariaLabel="Boat to enter"
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full"
            onClick={() => setMode("new")}
          >
            Create a new boat instead
          </Button>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-border/70 p-4">
          <div className="space-y-1">
            <Label htmlFor="join-new-boat-name">Create a new boat</Label>
            <p className="text-xs text-muted-foreground">
              Use this only for a different physical boat. You will become its owner.
            </p>
          </div>
          <Input
            id="join-new-boat-name"
            value={newBoat.name}
            onChange={(event) => setNewBoat({ ...newBoat, name: event.target.value })}
            maxLength={120}
            placeholder="Rock Steady"
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="join-new-sail-number">Sail number (optional)</Label>
              <Input
                id="join-new-sail-number"
                value={newBoat.sailNumber}
                onChange={(event) =>
                  setNewBoat({ ...newBoat, sailNumber: event.target.value })
                }
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="join-new-boat-class">Class (optional)</Label>
              <Input
                id="join-new-boat-class"
                value={newBoat.boatClass}
                onChange={(event) => setNewBoat({ ...newBoat, boatClass: event.target.value })}
                maxLength={80}
              />
            </div>
          </div>
          {boats.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full"
              onClick={() => setMode("existing")}
            >
              Use an existing boat instead
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="min-h-11 w-full"
        disabled={pending || (mode === "existing" && !boatId)}
      >
        {pending ? "Joining…" : "Join race"}
      </Button>
    </form>
  );
}
