"use client";

import { useState } from "react";
import { ArrowLeft, CloudSun, ExternalLink, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import type { RaceConditions } from "@/lib/races/meta";

interface SuggestionResponse {
  conditions: RaceConditions;
  resolvedLocation: string;
  warning: string | null;
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function WeatherFillWizard({
  raceId,
  defaultLocation,
  defaultStartsAt,
  defaultEndsAt,
  onApply,
}: {
  raceId: string;
  defaultLocation: string;
  defaultStartsAt: string;
  defaultEndsAt: string;
  onApply: (conditions: RaceConditions) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"configure" | "review">("configure");
  const [location, setLocation] = useState(defaultLocation);
  const [startsAt, setStartsAt] = useState(toLocalInputValue(defaultStartsAt));
  const [endsAt, setEndsAt] = useState(toLocalInputValue(defaultEndsAt));
  const [suggestion, setSuggestion] = useState<SuggestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setError(null);
    const startIso = localInputToIso(startsAt);
    const endIso = localInputToIso(endsAt);
    if (!location.trim() || !startIso || !endIso) {
      setError("Enter a location, start, and end time.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/races/${raceId}/weather/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, startsAt: startIso, endsAt: endIso }),
      });
      const payload = (await response.json()) as SuggestionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not fill weather conditions.");
      setSuggestion(payload);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fill weather conditions.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!suggestion) return;
    onApply(suggestion.conditions);
    setOpen(false);
    setStep("configure");
  }

  const evidence = suggestion?.conditions.source?.evidence;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError(null);
          setStep("configure");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Sparkles className="size-4" aria-hidden="true" />
          Fill from weather
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudSun className="size-4 text-primary" aria-hidden="true" />
            Weather fill wizard
          </DialogTitle>
          <DialogDescription>
            Retrieve race-window weather, let the configured AI summarize it, then review every
            field before applying it.
          </DialogDescription>
        </DialogHeader>

        {step === "configure" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="weather-location">Race location</Label>
              <Input
                id="weather-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Little Traverse Bay, Michigan"
              />
              <p className="text-xs text-muted-foreground">
                Include city, state, or country when the venue name could be ambiguous.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="weather-start">Race start</Label>
                <Input
                  id="weather-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weather-end">Race end</Label>
                <Input
                  id="weather-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </div>
            </div>
            <Alert>
              <AlertTitle>Confirm the time window</AlertTitle>
              <AlertDescription>
                Track timestamps are used when available. Otherwise these defaults come from the
                race record and may need correction.
              </AlertDescription>
            </Alert>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Could not generate conditions</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" onClick={generate} disabled={loading}>
                <Sparkles className="size-4" aria-hidden="true" />
                {loading ? "Retrieving and summarizing…" : "Generate suggestion"}
              </Button>
            </DialogFooter>
          </div>
        ) : suggestion && evidence ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Open-Meteo</Badge>
              <Badge variant="outline">{evidence.dataset}</Badge>
              {suggestion.conditions.source?.ai ? (
                <Badge variant="outline">AI · {suggestion.conditions.source.ai.model}</Badge>
              ) : (
                <Badge variant="outline">Deterministic fallback</Badge>
              )}
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
              <p className="font-medium">{suggestion.resolvedLocation}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(evidence.windowStart).toLocaleString()}–
                {new Date(evidence.windowEnd).toLocaleString()} · {evidence.sampleCount} hourly
                sample{evidence.sampleCount === 1 ? "" : "s"}
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Wind</dt>
                  <dd className="font-medium">
                    {evidence.windMinKts}–{evidence.windMaxKts} kt
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Direction</dt>
                  <dd className="font-medium">{evidence.windDirectionDeg}°</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Max gust</dt>
                  <dd className="font-medium">
                    {evidence.gustMaxKts === null ? "Not available" : `${evidence.gustMaxKts} kt`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Temperature</dt>
                  <dd className="font-medium">
                    {evidence.temperatureMinC === null || evidence.temperatureMaxC === null
                      ? "Not available"
                      : `${evidence.temperatureMinC}–${evidence.temperatureMaxC}°C`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Precipitation</dt>
                  <dd className="font-medium">
                    {evidence.precipitationMm === null
                      ? "Not available"
                      : `${evidence.precipitationMm} mm`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Model waves</dt>
                  <dd className="font-medium">
                    {evidence.waveHeightMinM === null || evidence.waveHeightMaxM === null
                      ? "Not available"
                      : `${evidence.waveHeightMinM}–${evidence.waveHeightMaxM} m`}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Sea state</p>
                <p className="mt-1 text-sm">{suggestion.conditions.seaState ?? "Left blank"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {suggestion.conditions.source?.seaStateBasis}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Condition notes</p>
                <p className="mt-1 text-sm">{suggestion.conditions.notes}</p>
              </div>
            </div>

            {suggestion.warning && (
              <Alert>
                <AlertTitle>AI fallback used</AlertTitle>
                <AlertDescription>{suggestion.warning}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-3 text-xs">
              <a
                href={evidence.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Atmospheric source <ExternalLink className="size-3" aria-hidden="true" />
              </a>
              {evidence.marineSourceUrl && (
                <a
                  href={evidence.marineSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Marine source <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("configure")}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Change inputs
              </Button>
              <Button type="button" onClick={apply}>Apply to form</Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
