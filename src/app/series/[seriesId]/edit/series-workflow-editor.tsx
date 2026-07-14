"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  applySeriesScoring,
  archiveSeries,
  previewSeriesScoring,
  saveSeriesSetup,
  type SeriesPreviewResponse,
} from "@/app/series/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LowPointConfigV1, SeriesOfficialStatus } from "@/lib/analytics/series/types";
import type { SeriesEditorModelV1 } from "@/lib/series/server";
import type { SeriesOfficialDraftRowV1 } from "@/lib/series/workflow";

type BoatRole = "competitor" | "guest";
type SetupRace = {
  raceId: string;
  included: boolean;
  discardEligible: boolean;
  state: "scheduled" | "completed" | "abandoned";
};

const NON_FINISH_STATUSES = ["dnf", "dns", "ocs", "ret", "dsq"] as const;
const OFFICIAL_STATUSES = ["fin", ...NON_FINISH_STATUSES] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function points(value: number | undefined): string {
  return value === undefined ? "—" : (value / 100).toFixed(2).replace(/\.00$/, "");
}

function analysisBadge(status: string) {
  const ready = status === "current";
  return <Badge variant={ready ? "secondary" : "destructive"}>{ready ? "Analysis ready" : status}</Badge>;
}

function parseDiscardSchedule(value: string): LowPointConfigV1["discardSchedule"] {
  const rows = value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [minimum, count, ...extra] = part.split(":").map((item) => item.trim());
    const minCompletedRaces = Number(minimum);
    const discards = Number(count);
    if (
      extra.length > 0 || !Number.isSafeInteger(minCompletedRaces) ||
      !Number.isSafeInteger(discards) || minCompletedRaces < 0 || discards < 0
    ) {
      throw new Error("Use threshold:discards pairs, for example 0:0, 5:1, 7:2.");
    }
    return { minCompletedRaces, discards };
  });
  if (rows.length === 0) throw new Error("Add at least one discard threshold.");
  return rows;
}

export function SeriesWorkflowEditor({ model }: { model: SeriesEditorModelV1 }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(model.series.revision);
  const [name, setName] = useState(model.series.name);
  const [venue, setVenue] = useState(model.series.venue ?? "");
  const [timezone, setTimezone] = useState(model.series.timezone ?? "");
  const [startsOn, setStartsOn] = useState(model.series.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(model.series.endsOn ?? "");
  const [config, setConfig] = useState<LowPointConfigV1>(model.projection.config);
  const [discardText, setDiscardText] = useState(
    model.projection.config.discardSchedule
      .map((row) => `${row.minCompletedRaces}:${row.discards}`)
      .join(", "),
  );
  const [linkedRaces, setLinkedRaces] = useState<SetupRace[]>(model.races.map((race) => ({
    raceId: race.raceId,
    included: race.included,
    discardEligible: race.discardEligible,
    state: race.state,
  })));
  const [roles, setRoles] = useState<Record<string, BoatRole | undefined>>(
    Object.fromEntries(model.competitors.map((row) => [row.boatId, row.role])),
  );
  const [aliasTargets, setAliasTargets] = useState<Record<string, string | undefined>>(
    Object.fromEntries(model.aliases.map((row) => [row.sourceBoatId, row.canonicalBoatId])),
  );
  const [draftRows, setDraftRows] = useState<Record<string, SeriesOfficialDraftRowV1[]>>(
    Object.fromEntries(model.projection.raceDrafts.map((race) => [race.raceId, race.rows])),
  );
  const [preview, setPreview] = useState<SeriesPreviewResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupDirty, setSetupDirty] = useState(false);

  const raceById = useMemo(
    () => new Map(model.availableRaces.map((race) => [race.id, race])),
    [model.availableRaces],
  );
  const boatById = useMemo(() => new Map(model.boats.map((boat) => [boat.id, boat])), [model.boats]);
  const linkedIds = new Set(linkedRaces.map((race) => race.raceId));
  const selectedBoatIds = [...new Set([
    ...linkedRaces.flatMap((race) => raceById.get(race.raceId)?.entryBoatIds ?? []),
    ...Object.keys(roles).filter((boatId) => roles[boatId]),
    ...Object.keys(aliasTargets).filter((boatId) => aliasTargets[boatId]),
  ])].sort((left, right) => {
    const leftName = boatById.get(left)?.name ?? left;
    const rightName = boatById.get(right)?.name ?? right;
    return leftName.localeCompare(rightName);
  });
  const canonicalBoatIds = Object.entries(roles)
    .filter((entry): entry is [string, "competitor"] => entry[1] === "competitor")
    .map(([boatId]) => boatId);

  function markSetupChanged() {
    setSetupDirty(true);
    setPreview(null);
    setScoreError(null);
    setNotice(null);
  }

  function markOfficialChanged() {
    setPreview(null);
    setScoreError(null);
    setNotice(null);
  }

  function updateRace(index: number, patch: Partial<SetupRace>) {
    setLinkedRaces((current) => current.map((race, raceIndex) =>
      raceIndex === index ? { ...race, ...patch } : race));
    markSetupChanged();
  }

  function moveRace(index: number, direction: -1 | 1) {
    setLinkedRaces((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markSetupChanged();
  }

  function setIdentity(boatId: string, identity: "unresolved" | "competitor" | "guest" | "alias") {
    setRoles((current) => {
      const next = { ...current };
      if (identity === "competitor" || identity === "guest") next[boatId] = identity;
      else delete next[boatId];
      return next;
    });
    setAliasTargets((current) => {
      const next = { ...current };
      if (identity === "alias") {
        next[boatId] = next[boatId] ?? canonicalBoatIds.find((id) => id !== boatId);
      } else {
        delete next[boatId];
      }
      return next;
    });
    markSetupChanged();
  }

  function saveSetup() {
    setSetupError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const discardSchedule = parseDiscardSchedule(discardText);
        const result = await saveSeriesSetup({
          seriesId: model.series.id,
          expectedRevision: revision,
          name,
          venue,
          timezone,
          startsOn: startsOn || null,
          endsOn: endsOn || null,
          scoringVersion: model.series.scoringVersion,
          scoringConfig: { ...config, discardSchedule },
          races: linkedRaces.map((race, index) => ({
            ...race,
            sequence: index + 1,
          })),
          competitors: Object.entries(roles)
            .filter((entry): entry is [string, BoatRole] => Boolean(entry[1]))
            .map(([boatId, role]) => ({ boatId, role })),
          aliases: Object.entries(aliasTargets)
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
            .map(([sourceBoatId, canonicalBoatId]) => ({
              sourceBoatId,
              canonicalBoatId,
              note: "Explicit organizer resolution",
            })),
        });
        setRevision(result.revision);
        setNotice("Series setup saved. Official-result drafts were rebuilt from current evidence.");
        router.refresh();
      } catch (error) {
        setSetupError(errorMessage(error));
      }
    });
  }

  function setOfficialRow(raceId: string, entryId: string, patch: Partial<SeriesOfficialDraftRowV1>) {
    setDraftRows((current) => ({
      ...current,
      [raceId]: (current[raceId] ?? []).map((row) =>
        row.entryId === entryId ? { ...row, ...patch } : row),
    }));
    markOfficialChanged();
  }

  function draftPayload() {
    return model.races.map((race) => ({
      raceId: race.raceId,
      rows: draftRows[race.raceId] ?? [],
    }));
  }

  function runPreview() {
    setScoreError(null);
    setNotice(null);
    if (setupDirty) {
      setScoreError("Save setup changes before previewing official results.");
      return;
    }
    startTransition(async () => {
      try {
        const response = await previewSeriesScoring({
          seriesId: model.series.id,
          expectedRevision: revision,
          draftOfficialResults: draftPayload(),
        });
        setPreview(response);
        setDraftRows(Object.fromEntries(
          response.projection.raceDrafts.map((race) => [race.raceId, race.rows]),
        ));
      } catch (error) {
        setScoreError(errorMessage(error));
      }
    });
  }

  function applyPreview() {
    setScoreError(null);
    setNotice(null);
    if (setupDirty) {
      setScoreError("Save setup changes before applying a scoring snapshot.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await applySeriesScoring({
          seriesId: model.series.id,
          expectedRevision: revision,
          draftOfficialResults: draftPayload(),
        });
        setRevision(result.revision);
        setNotice(result.idempotent
          ? `Snapshot revision ${result.snapshotRevision} already matches these inputs; no history was added.`
          : `Applied immutable snapshot revision ${result.snapshotRevision}.`);
        router.refresh();
      } catch (error) {
        setScoreError(errorMessage(error));
      }
    });
  }

  function toggleArchive() {
    setSetupError(null);
    startTransition(async () => {
      try {
        await archiveSeries({
          seriesId: model.series.id,
          expectedRevision: revision,
          archived: !model.series.archivedAt,
        });
        setRevision((current) => current + 1);
        router.refresh();
      } catch (error) {
        setSetupError(errorMessage(error));
      }
    });
  }

  const comparison = preview?.projection.result;
  const oldStandings = new Map(
    (preview?.previousSnapshot?.result.standings ?? []).map((standing) => [
      standing.boatId,
      standing.netPointsHundredths,
    ]),
  );

  return (
    <div className="space-y-8 py-8">
      {notice ? (
        <Alert>
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>1. Series setup</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={toggleArchive} disabled={pending || setupDirty}>
                {model.series.archivedAt ? <Undo2 className="size-4" /> : <Archive className="size-4" />}
                {model.series.archivedAt ? "Restore" : "Archive"}
              </Button>
              <Button onClick={saveSetup} disabled={pending || !setupDirty}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save setup
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="series-editor-name">Name</Label>
              <Input id="series-editor-name" value={name} onChange={(event) => {
                setName(event.target.value);
                markSetupChanged();
              }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-editor-venue">Venue</Label>
              <Input id="series-editor-venue" value={venue} onChange={(event) => {
                setVenue(event.target.value);
                markSetupChanged();
              }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-editor-timezone">Timezone</Label>
              <Input
                id="series-editor-timezone"
                value={timezone}
                placeholder="America/Detroit"
                onChange={(event) => {
                  setTimezone(event.target.value);
                  markSetupChanged();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-editor-start">Starts on</Label>
              <Input id="series-editor-start" type="date" value={startsOn} onChange={(event) => {
                setStartsOn(event.target.value);
                markSetupChanged();
              }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-editor-end">Ends on</Label>
              <Input id="series-editor-end" type="date" value={endsOn} onChange={(event) => {
                setEndsOn(event.target.value);
                markSetupChanged();
              }} />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="font-medium">Scoring rules</h3>
              <p className="text-sm text-muted-foreground">
                Low Point V1 · explicit non-finish populations, penalties, and discard thresholds.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="count-guests">Count guests in race populations</Label>
              <Switch
                id="count-guests"
                checked={config.countGuestsInPopulation}
                onCheckedChange={(checked) => {
                  setConfig((current) => ({ ...current, countGuestsInPopulation: checked }));
                  markSetupChanged();
                }}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {NON_FINISH_STATUSES.map((status) => (
                <div key={status} className="space-y-3 rounded-lg border p-3">
                  <p className="font-medium uppercase">{status}</p>
                  <Select
                    value={config.statusScores[status].population}
                    onValueChange={(population: "entrants" | "starters") => {
                      setConfig((current) => ({
                        ...current,
                        statusScores: {
                          ...current.statusScores,
                          [status]: { ...current.statusScores[status], population },
                        },
                      }));
                      markSetupChanged();
                    }}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starters">Starters</SelectItem>
                      <SelectItem value="entrants">Entrants</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="space-y-1">
                    <Label htmlFor={`status-${status}`}>Add points</Label>
                    <Input
                      id={`status-${status}`}
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      value={config.statusScores[status].addPoints}
                      onChange={(event) => {
                        const addPoints = Number(event.target.value);
                        setConfig((current) => ({
                          ...current,
                          statusScores: {
                            ...current.statusScores,
                            [status]: { ...current.statusScores[status], addPoints },
                          },
                        }));
                        markSetupChanged();
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="discard-schedule">Discard schedule</Label>
              <Input
                id="discard-schedule"
                value={discardText}
                onChange={(event) => {
                  setDiscardText(event.target.value);
                  markSetupChanged();
                }}
                placeholder="0:0, 5:1, 7:2"
              />
              <p className="text-xs text-muted-foreground">
                Enter completed-race threshold:discard-count pairs in ascending order.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="font-medium">Ordered races</h3>
              <p className="text-sm text-muted-foreground">
                Only races you organize can be attached. State and inclusion are explicit series decisions.
              </p>
            </div>
            {linkedRaces.length ? (
              <div className="space-y-3">
                {linkedRaces.map((linked, index) => {
                  const race = raceById.get(linked.raceId);
                  const officialRows = draftRows[linked.raceId] ?? [];
                  const confirmedCount = officialRows.filter((row) => row.confirmed).length;
                  return (
                    <div key={linked.raceId} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[auto_1fr_auto_auto_auto_auto] lg:items-center">
                      <span className="text-sm font-semibold">{index + 1}</span>
                      <div>
                        <p className="font-medium">{race?.name ?? linked.raceId}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {analysisBadge(race?.analysisStatus ?? "missing")}
                          <Badge variant={
                            officialRows.length > 0 && confirmedCount === officialRows.length
                              ? "secondary"
                              : "outline"
                          }>
                            {confirmedCount}/{officialRows.length} official
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {race?.entryBoatIds.length ?? 0} entries
                          </span>
                        </div>
                      </div>
                      <Select value={linked.state} onValueChange={(state: SetupRace["state"]) => updateRace(index, { state })}>
                        <SelectTrigger className="w-full lg:w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scheduled">Scheduled</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="abandoned">Abandoned</SelectItem>
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={linked.included} onCheckedChange={(included) => updateRace(index, { included })} />
                        Included
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={linked.discardEligible} onCheckedChange={(discardEligible) => updateRace(index, { discardEligible })} />
                        Discardable
                      </label>
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon-sm" aria-label="Move race up" disabled={index === 0} onClick={() => moveRace(index, -1)}>
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon-sm" aria-label="Move race down" disabled={index === linkedRaces.length - 1} onClick={() => moveRace(index, 1)}>
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon-sm" aria-label="Remove race" onClick={() => {
                          setLinkedRaces((current) => current.filter((item) => item.raceId !== linked.raceId));
                          markSetupChanged();
                        }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-muted-foreground">No races selected.</p>}
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {model.availableRaces.filter((race) => !linkedIds.has(race.id)).map((race) => (
                <Button
                  key={race.id}
                  variant="outline"
                  className="h-auto justify-between py-3"
                  onClick={() => {
                    setLinkedRaces((current) => [...current, {
                      raceId: race.id,
                      included: true,
                      discardEligible: true,
                      state: "scheduled",
                    }]);
                    markSetupChanged();
                  }}
                >
                  <span className="min-w-0 truncate">{race.name}</span>
                  <Plus className="size-4" />
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="font-medium">Competitors, guests, and aliases</h3>
              <p className="text-sm text-muted-foreground">
                Identity is based only on stable boat IDs. Duplicate historical records require an explicit alias.
              </p>
            </div>
            {selectedBoatIds.length ? (
              <div className="space-y-2">
                {selectedBoatIds.map((boatId) => {
                  const boat = boatById.get(boatId);
                  const identity = roles[boatId] ?? (aliasTargets[boatId] ? "alias" : "unresolved");
                  return (
                    <div key={boatId} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_12rem_1fr] md:items-center">
                      <div>
                        <p className="font-medium">{boat?.name ?? "Unknown boat"}</p>
                        <p className="text-xs text-muted-foreground">
                          {boat?.sailNumber ? `Sail ${boat.sailNumber} · ` : ""}{boatId}
                        </p>
                      </div>
                      <Select value={identity} onValueChange={(value: typeof identity) => setIdentity(boatId, value)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unresolved">Unresolved</SelectItem>
                          <SelectItem value="competitor">Competitor</SelectItem>
                          <SelectItem value="guest">Guest</SelectItem>
                          <SelectItem value="alias">Alias</SelectItem>
                        </SelectContent>
                      </Select>
                      {identity === "alias" ? (
                        canonicalBoatIds.filter((id) => id !== boatId).length ? (
                          <Select
                            value={aliasTargets[boatId]}
                            onValueChange={(canonicalBoatId) => {
                              setAliasTargets((current) => ({ ...current, [boatId]: canonicalBoatId }));
                              markSetupChanged();
                            }}
                          >
                            <SelectTrigger className="w-full"><SelectValue placeholder="Canonical competitor" /></SelectTrigger>
                            <SelectContent>
                              {canonicalBoatIds.filter((id) => id !== boatId).map((id) => (
                                <SelectItem key={id} value={id}>{boatById.get(id)?.name ?? id}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : <p className="text-sm text-destructive">Register a canonical competitor first.</p>
                      ) : <span className="text-xs text-muted-foreground">Stable boat ID</span>}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-muted-foreground">Select a race to load its boats.</p>}
          </div>

          {setupError ? <p className="text-sm text-destructive">{setupError}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Confirm official race results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Performance results seed these rows from the last saved setup. The organizer must confirm status, place/tie, and penalty before a completed included race can score.
          </p>
          {setupDirty ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              <AlertTitle>Save setup before confirming results</AlertTitle>
              <AlertDescription>
                Race order, identity, and scoring-rule edits are not persisted yet. Official rows, Preview, and Apply stay disabled until Save setup reloads current evidence.
              </AlertDescription>
            </Alert>
          ) : null}
          <fieldset
            disabled={setupDirty || pending}
            className={setupDirty ? "space-y-6 opacity-60" : "space-y-6"}
          >
          {model.races.length ? model.races.map((race) => {
            const rows = draftRows[race.raceId] ?? [];
            return (
              <section key={race.raceId} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{race.sequence}. {race.raceName}</h3>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {analysisBadge(race.analysisStatus)}
                      <Badge variant="outline">{race.state}</Badge>
                      {!race.included ? <Badge variant="outline">Excluded</Badge> : null}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => {
                    setDraftRows((current) => ({
                      ...current,
                      [race.raceId]: rows.map((row) => ({
                        ...row,
                        confirmed: row.identity !== "unresolved",
                      })),
                    }));
                    markOfficialChanged();
                  }}>
                    Confirm resolved rows
                  </Button>
                </div>
                {rows.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Boat</TableHead>
                        <TableHead>Identity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Place</TableHead>
                        <TableHead>Tie</TableHead>
                        <TableHead>Penalty</TableHead>
                        <TableHead>Confirmed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.entryId}>
                          <TableCell>
                            <p className="font-medium">
                              {boatById.get(row.boatId)?.name ?? row.boatName}
                            </p>
                            {row.origin === "absent-competitor" ? (
                              <p className="text-xs text-muted-foreground">
                                No race entry · explicit DNS
                              </p>
                            ) : null}
                            <p className="max-w-48 truncate text-xs text-muted-foreground">{row.sourceBoatId}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.identity === "unresolved" ? "destructive" : "secondary"}>
                              {row.identity}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={row.status}
                              disabled={row.origin === "absent-competitor"}
                              onValueChange={(status: SeriesOfficialStatus) => setOfficialRow(
                                race.raceId,
                                row.entryId,
                                status === "fin"
                                  ? { status, confirmed: false }
                                  : { status, place: null, tied: false, confirmed: false },
                              )}
                            >
                              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {OFFICIAL_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>{status.toUpperCase()}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              className="w-20"
                              type="number"
                              min="1"
                              step="1"
                              disabled={row.status !== "fin"}
                              value={row.place ?? ""}
                              onChange={(event) => setOfficialRow(race.raceId, row.entryId, {
                                place: event.target.value ? Number(event.target.value) : null,
                                confirmed: false,
                              })}
                            />
                          </TableCell>
                          <TableCell>
                            <Switch
                              aria-label={`Tie for ${row.boatName}`}
                              disabled={row.status !== "fin"}
                              checked={row.tied}
                              onCheckedChange={(tied) => setOfficialRow(race.raceId, row.entryId, { tied, confirmed: false })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="w-24"
                              type="number"
                              min="0"
                              max="10000"
                              step="0.01"
                              value={row.penaltyPoints}
                              onChange={(event) => setOfficialRow(race.raceId, row.entryId, {
                                penaltyPoints: Number(event.target.value),
                                confirmed: false,
                              })}
                            />
                          </TableCell>
                          <TableCell>
                            <Switch
                              aria-label={`Confirm ${row.boatName}`}
                              disabled={row.identity === "unresolved"}
                              checked={row.confirmed}
                              onCheckedChange={(confirmed) => setOfficialRow(race.raceId, row.entryId, { confirmed })}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-sm text-muted-foreground">This race has no entries.</p>}
              </section>
            );
          }) : (
            <p className="text-sm text-muted-foreground">
              Save at least one selected race before confirming official results.
            </p>
          )}
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>3. Preview and apply</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={runPreview} disabled={pending || setupDirty || model.races.length === 0}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Preview scoring
              </Button>
              <Button
                onClick={applyPreview}
                disabled={pending || setupDirty || preview?.projection.status !== "ready" || !preview.projection.result}
              >
                Apply snapshot
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Preview and Apply independently re-read current entries, analyses, corrections, identity, and series revision on the server.
          </p>
          {scoreError ? <p className="text-sm text-destructive">{scoreError}</p> : null}
          {preview?.projection.status === "blocked" ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              <AlertTitle>Scoring is blocked</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {preview.projection.issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.raceId}-${issue.entryId}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {comparison ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Ready</Badge>
                <Badge variant="outline">{comparison.completedRaceCount} completed races</Badge>
                <Badge variant="outline">{comparison.discardCount} discards</Badge>
                <Badge variant="outline">Fingerprint {comparison.sourceFingerprint.slice(0, 12)}…</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Competitor</TableHead>
                    <TableHead>Previous</TableHead>
                    <TableHead>Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.standings.map((standing) => (
                    <TableRow key={standing.boatId}>
                      <TableCell>{standing.rank}{standing.tied ? "T" : ""}</TableCell>
                      <TableCell className="font-medium">
                        {boatById.get(standing.boatId)?.name ?? standing.boatId}
                      </TableCell>
                      <TableCell>{points(oldStandings.get(standing.boatId))}</TableCell>
                      <TableCell>{points(standing.netPointsHundredths)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Previous snapshot: {preview.previousSnapshot
                  ? `revision ${preview.previousSnapshot.revision}`
                  : "none"}. Apply persists this exact fingerprint or returns the matching existing snapshot.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
