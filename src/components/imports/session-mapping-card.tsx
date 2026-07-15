"use client";

import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { suggestDefaultMapping } from "@/lib/imports/default-mapping";
import { isValidIanaTimezone, normalizeIanaTimezone } from "@/lib/races/meta";
import type {
  HistoricalImportItemPublic,
  HistoricalImportMapping,
} from "@/lib/imports/types";
import { localDateTimeToUtc } from "@/lib/sessions/local-datetime";
import { formatSessionDateTime, sessionBadgeLabel } from "@/lib/sessions/format";
import type { SessionType } from "@/lib/sessions/types";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function safeTimezone(timeZone: string | null | undefined): string {
  const normalized = timeZone ? normalizeIanaTimezone(timeZone) : null;
  if (normalized && isValidIanaTimezone(normalized)) return normalized;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function isoToLocalParts(iso: string, timeZone: string): { date: string; time: string } {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    const now = new Date();
    return {
      date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    };
  }
  const zone = safeTimezone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${get("hour")}:${get("minute")}`,
    };
  } catch {
    const utc = new Date(ms);
    return {
      date: `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`,
      time: `${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())}`,
    };
  }
}

function browserTimezone(): string {
  return safeTimezone(null);
}

export function SessionMappingCard({
  item,
  busy,
  onSave,
  onSkip,
}: {
  item: HistoricalImportItemPublic;
  busy?: boolean;
  onSave: (mapping: HistoricalImportMapping) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const inspection = item.inspection;
  const initial =
    item.mapping ??
    (inspection ? suggestDefaultMapping(inspection) : null);

  const anchorIso =
    initial?.target === "new"
      ? initial.startsAt
      : inspection?.startedAt ?? new Date().toISOString();

  const [target, setTarget] = useState<"new" | "existing">(
    initial?.target === "existing" ? "existing" : "new",
  );
  const [existingSessionId, setExistingSessionId] = useState(
    initial?.target === "existing"
      ? initial.existingSessionId
      : inspection?.candidates.find((row) => row.eligible && !row.hasTrack)?.sessionId ?? "",
  );
  const [sessionType, setSessionType] = useState<SessionType>(
    initial?.target === "new"
      ? initial.sessionType
      : inspection?.proposedSessionType.sessionType ?? "practice",
  );
  const [timezone, setTimezone] = useState(
    safeTimezone(initial?.target === "new" ? initial.timezone : browserTimezone()),
  );
  const [localDate, setLocalDate] = useState(
    () => isoToLocalParts(anchorIso, timezone).date,
  );
  const [localTime, setLocalTime] = useState(
    () => isoToLocalParts(anchorIso, timezone).time,
  );
  const [venue, setVenue] = useState(
    initial?.target === "new" ? (initial.venue ?? "") : "",
  );
  const [name, setName] = useState(
    initial?.target === "new" ? (initial.name ?? "") : "",
  );
  const [importAnyway, setImportAnyway] = useState(
    initial?.importAnyway ?? inspection?.duplicate.kind === "probable",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!inspection) {
    return (
      <div className="rounded-lg border border-border/70 px-3 py-3 text-sm text-muted-foreground">
        Inspect {item.originalFilename} before mapping a session.
      </div>
    );
  }

  const exactDuplicate = inspection.duplicate.kind === "exact";
  const probableDuplicate = inspection.duplicate.kind === "probable";
  const eligible = inspection.candidates.filter((row) => row.eligible && !row.hasTrack);

  function changeTimezone(next: string) {
    // Preserve the instant implied by the current local fields under the old zone.
    const [year, month, day] = localDate.split("-").map(Number);
    const [hour, minute] = localTime.split(":").map(Number);
    const converted = localDateTimeToUtc(
      { year: year ?? 0, month: month ?? 1, day: day ?? 1, hour: hour ?? 0, minute: minute ?? 0 },
      timezone,
    );
    const sourceIso = converted.ok ? converted.iso : anchorIso;
    const parts = isoToLocalParts(sourceIso, next);
    setTimezone(next);
    setLocalDate(parts.date);
    setLocalTime(parts.time);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      if (exactDuplicate) {
        throw new Error("Exact duplicates cannot be imported. Skip this file.");
      }
      if (probableDuplicate && !importAnyway) {
        throw new Error("Acknowledge the probable duplicate to continue.");
      }
      let mapping: HistoricalImportMapping;
      if (target === "existing") {
        if (!existingSessionId) {
          throw new Error("Choose an existing session.");
        }
        mapping = {
          target: "existing",
          existingSessionId,
          importAnyway,
        };
      } else {
        const [year, month, day] = localDate.split("-").map(Number);
        const [hour, minute] = localTime.split(":").map(Number);
        const converted = localDateTimeToUtc(
          { year, month, day, hour, minute },
          timezone,
        );
        if (!converted.ok) {
          throw new Error(
            converted.reason === "nonexistent"
              ? "That local time does not exist (DST gap)."
              : converted.reason === "ambiguous"
                ? "That local time is ambiguous (DST overlap)."
                : "Enter a valid date, time, and timezone.",
          );
        }
        mapping = {
          target: "new",
          sessionType,
          startsAt: converted.iso,
          timezone,
          venue: venue.trim() || null,
          name: name.trim() || null,
          importAnyway,
        };
      }
      await onSave(mapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save mapping.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="space-y-4 rounded-lg border border-border/70 bg-card/40 px-3 py-4 sm:px-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{item.originalFilename}</h3>
          <Badge variant="outline">
            {sessionBadgeLabel(inspection.proposedSessionType.sessionType)}
          </Badge>
          <Badge variant="secondary">
            {inspection.proposedSessionType.confidence} confidence
          </Badge>
          {item.status === "ready" ? <Badge>Mapped</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {inspection.proposedSessionType.reason}
        </p>
        <p className="text-xs text-muted-foreground">
          Track{" "}
          {formatSessionDateTime(inspection.startedAt, timezone)} –{" "}
          {formatSessionDateTime(inspection.endedAt, timezone)} ·{" "}
          {inspection.distanceNm.toFixed(1)} nm
        </p>
      </header>

      {exactDuplicate ? (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Exact duplicate — this file cannot be committed. Skip it to continue.
        </p>
      ) : null}

      {probableDuplicate ? (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={importAnyway}
            onChange={(event) => setImportAnyway(event.target.checked)}
          />
          <span>
            This looks like a probable duplicate of an existing track. Import anyway.
          </span>
        </label>
      ) : null}

      {!exactDuplicate ? (
        <fieldset className="space-y-3">
          <Legend>Session mapping</Legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              className="min-h-11 justify-start"
              variant={target === "new" ? "default" : "outline"}
              onClick={() => setTarget("new")}
            >
              Create new session
            </Button>
            <Button
              type="button"
              className="min-h-11 justify-start"
              variant={target === "existing" ? "default" : "outline"}
              disabled={eligible.length === 0}
              onClick={() => setTarget("existing")}
            >
              Link existing session
            </Button>
          </div>

          {target === "existing" ? (
            <div className="space-y-2">
              <Label htmlFor={`existing-${item.id}`}>Existing session</Label>
              <Select
                value={existingSessionId}
                onValueChange={setExistingSessionId}
              >
                <SelectTrigger id={`existing-${item.id}`} className="min-h-11">
                  <SelectValue placeholder="Choose a session" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((candidate) => (
                    <SelectItem key={candidate.sessionId} value={candidate.sessionId}>
                      {candidate.name} · {sessionBadgeLabel(candidate.sessionType)} ·{" "}
                      {formatSessionDateTime(candidate.startsAt, candidate.timezone)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Session type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className="min-h-11"
                    variant={sessionType === "race" ? "default" : "outline"}
                    onClick={() => setSessionType("race")}
                  >
                    Race
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    variant={sessionType === "practice" ? "default" : "outline"}
                    onClick={() => setSessionType("practice")}
                  >
                    Practice
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`date-${item.id}`}>Local date</Label>
                <Input
                  id={`date-${item.id}`}
                  type="date"
                  className="min-h-11"
                  value={localDate}
                  onChange={(event) => setLocalDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`time-${item.id}`}>Local time</Label>
                <Input
                  id={`time-${item.id}`}
                  type="time"
                  className="min-h-11"
                  value={localTime}
                  onChange={(event) => setLocalTime(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor={`tz-${item.id}`}>Timezone (IANA)</Label>
                <Input
                  id={`tz-${item.id}`}
                  className="min-h-11"
                  value={timezone}
                  onChange={(event) => changeTimezone(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`name-${item.id}`}>Name (optional)</Label>
                <Input
                  id={`name-${item.id}`}
                  className="min-h-11"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`venue-${item.id}`}>Venue (optional)</Label>
                <Input
                  id={`venue-${item.id}`}
                  className="min-h-11"
                  value={venue}
                  onChange={(event) => setVenue(event.target.value)}
                />
              </div>
            </div>
          )}
        </fieldset>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {!exactDuplicate ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || saving}
            onClick={() => void handleSave()}
          >
            {item.status === "ready" ? "Update mapping" : "Save mapping"}
          </Button>
        ) : null}
        <Button
          type="button"
          className="min-h-11"
          variant="outline"
          disabled={busy || saving}
          onClick={() => void onSkip()}
        >
          Skip file
        </Button>
      </div>
    </article>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <legend className="text-sm font-medium text-foreground">{children}</legend>
  );
}
