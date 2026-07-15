"use client";

import { useState, useTransition } from "react";
import { Plus, Save, X } from "lucide-react";

import { updateEntryMeta, updateRaceMeta } from "@/app/races/actions";
import { WeatherFillWizard } from "@/app/races/[raceId]/weather-fill-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  resolvePerformanceTimezone,
  type RaceConditions,
} from "@/lib/races/meta";

function TagsInput({
  tags,
  onChange,
  disabled,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...tags];
    for (const part of parts) {
      if (!next.some((t) => t.toLowerCase() === part.toLowerCase())) {
        next.push(part);
      }
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            {!disabled && (
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </Badge>
        ))}
        {tags.length === 0 && (
          <span className="text-xs text-muted-foreground">No tags yet</span>
        )}
      </div>
      {!disabled && (
        <Input
          value={draft}
          placeholder={placeholder ?? "Add tag and press Enter"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      )}
    </div>
  );
}

export function RaceMetaPanel({
  raceId,
  canEdit,
  initialConditions,
  initialTags,
  initialTimezone,
  defaultWeatherLocation,
  defaultWeatherStartsAt,
  defaultWeatherEndsAt,
  title = "Race conditions",
  description = "Wind, sea state, and tags for later performance correlation.",
}: {
  raceId: string;
  canEdit: boolean;
  initialConditions: RaceConditions | null;
  initialTags: string[];
  initialTimezone: string | null;
  defaultWeatherLocation: string;
  defaultWeatherStartsAt: string;
  defaultWeatherEndsAt: string;
  title?: string;
  description?: string;
}) {
  const [conditions, setConditions] = useState<RaceConditions>(
    initialConditions ?? {
      windMinKts: null,
      windMaxKts: null,
      windDirDeg: null,
      seaState: null,
      notes: null,
      source: null,
    },
  );
  const [tags, setTags] = useState(initialTags);
  const [timezone, setTimezone] = useState(initialTimezone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setNum(key: "windMinKts" | "windMaxKts" | "windDirDeg", raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    setConditions((c) => ({
      ...c,
      [key]: value !== null && Number.isFinite(value) ? value : null,
      source: null,
    }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateRaceMeta(raceId, {
          conditions,
          tags,
          timezone: timezone.trim() || null,
        });
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  const summaryBits: string[] = [];
  if (conditions.windMinKts !== null || conditions.windMaxKts !== null) {
    const min = conditions.windMinKts ?? "?";
    const max = conditions.windMaxKts ?? "?";
    summaryBits.push(`${min}–${max} kts`);
  }
  if (conditions.windDirDeg !== null) summaryBits.push(`${conditions.windDirDeg}°`);
  if (conditions.seaState) summaryBits.push(conditions.seaState);
  const resolvedTimezone = resolvePerformanceTimezone(timezone, conditions);
  const timezoneSource = resolvedTimezone.source === "race"
    ? "Saved on this race"
    : resolvedTimezone.source === "weather-location"
      ? "Weather-location fallback — save to make explicit"
      : "UTC fallback — set the race timezone before publishing local times";

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {!canEdit && summaryBits.length > 0 && (
            <span className="text-xs text-muted-foreground">{summaryBits.join(" · ")}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="race-timezone">Race timezone (IANA)</Label>
          <Input
            id="race-timezone"
            disabled={!canEdit}
            maxLength={100}
            placeholder="America/Detroit"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {resolvedTimezone.iana} · {timezoneSource}. Analytics remain stored in UTC.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="wind-min">Wind min (kts)</Label>
            <Input
              id="wind-min"
              type="number"
              inputMode="decimal"
              disabled={!canEdit}
              value={conditions.windMinKts ?? ""}
              onChange={(e) => setNum("windMinKts", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wind-max">Wind max (kts)</Label>
            <Input
              id="wind-max"
              type="number"
              inputMode="decimal"
              disabled={!canEdit}
              value={conditions.windMaxKts ?? ""}
              onChange={(e) => setNum("windMaxKts", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wind-dir">Wind dir (°)</Label>
            <Input
              id="wind-dir"
              type="number"
              inputMode="decimal"
              disabled={!canEdit}
              value={conditions.windDirDeg ?? ""}
              onChange={(e) => setNum("windDirDeg", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sea-state">Sea state</Label>
          <Input
            id="sea-state"
            disabled={!canEdit}
            placeholder="Flat / chop / leftover swell"
            value={conditions.seaState ?? ""}
            onChange={(e) =>
              setConditions((c) => ({ ...c, seaState: e.target.value || null, source: null }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="conditions-notes">Notes</Label>
          <Textarea
            id="conditions-notes"
            disabled={!canEdit}
            placeholder="Current, pressure drops, course notes…"
            value={conditions.notes ?? ""}
            onChange={(e) =>
              setConditions((c) => ({ ...c, notes: e.target.value || null, source: null }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Race tags</Label>
          <TagsInput
            tags={tags}
            onChange={setTags}
            disabled={!canEdit}
            placeholder="e.g. Tuesday night, buoy race"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {conditions.source && (
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              Weather source: {conditions.source.evidence.provider === "open-meteo" ? "Open-Meteo" : conditions.source.evidence.provider}
              {conditions.source.ai ? ` · summarized by ${conditions.source.ai.model}` : " · deterministic summary"}
            </p>
            <a
              href={conditions.source.evidence.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-primary hover:underline"
            >
              View source request
            </a>
            {!conditions.source.evidence.hourly?.length && (
              <p className="mt-1">Refresh weather to add timeline.</p>
            )}
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-3">
            <WeatherFillWizard
              raceId={raceId}
              defaultLocation={defaultWeatherLocation}
              defaultStartsAt={defaultWeatherStartsAt}
              defaultEndsAt={defaultWeatherEndsAt}
              onApply={(nextConditions, suggestedTimezone) => {
                setConditions(nextConditions);
                if (suggestedTimezone) setTimezone(suggestedTimezone);
              }}
            />
            <Button type="button" onClick={save} disabled={pending}>
              <Save className="size-4" aria-hidden="true" />
              {pending ? "Saving…" : "Save conditions"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EntryMetaEditor({
  entryId,
  canEdit,
  initialCrew,
  initialTags,
}: {
  entryId: string;
  canEdit: boolean;
  initialCrew: { name: string; role: string }[];
  initialTags: string[];
}) {
  const [crew, setCrew] = useState(initialCrew);
  const [tags, setTags] = useState(initialTags);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateEntryMeta(entryId, { crew, tags });
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  if (!canEdit && crew.length === 0 && tags.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border/50 pt-3 text-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Crew</span>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCrew((c) => [...c, { name: "", role: "" }])}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add
            </Button>
          )}
        </div>
        {crew.length === 0 ? (
          <p className="text-xs text-muted-foreground">No crew listed</p>
        ) : (
          <ul className="space-y-2">
            {crew.map((row, index) => (
              <li key={index} className="flex items-center gap-2">
                {canEdit ? (
                  <>
                    <Input
                      placeholder="Name"
                      value={row.name}
                      onChange={(e) =>
                        setCrew((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, name: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <Input
                      placeholder="Role"
                      value={row.role}
                      onChange={(e) =>
                        setCrew((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, role: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove crew member"
                      onClick={() => setCrew((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {row.name}
                    {row.role ? ` · ${row.role}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Sail / setup tags</span>
        <TagsInput
          tags={tags}
          onChange={setTags}
          disabled={!canEdit}
          placeholder="e.g. 3Di J2, AP main"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {canEdit && (
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={pending}>
          <Save className="size-3.5" aria-hidden="true" />
          {pending ? "Saving…" : "Save entry meta"}
        </Button>
      )}
    </div>
  );
}
