"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  addBoatCrewPerson,
  addBoatSail,
  addBoatSessionTagDef,
  addBoatSetup,
  archiveBoatCrewPerson,
  archiveBoatSail,
  archiveBoatSessionTagDef,
  archiveBoatSetup,
  saveSessionMetadataSnapshotAction,
} from "@/app/boats/metadata-actions";
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
import {
  SAIL_TYPES,
  emptySessionMetadataPayload,
  type BoatMetadataCatalogs,
  type LatestSessionSnapshot,
  type SessionMetadataPayloadV1,
} from "@/lib/boats/metadata";
import type { BoatSessionListItem } from "@/lib/boats/boat-sessions";
import { sessionWorkspaceHref } from "@/components/sessions/session-workspace-nav";
import {
  formatSessionDateTime,
  sessionBadgeLabel,
} from "@/lib/sessions/format";

function CatalogList({
  empty,
  items,
}: {
  empty: string;
  items: ReactNode[];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return <ul className="divide-y divide-border/60">{items}</ul>;
}

export function BoatSetupPanel({
  boatId,
  boatClass,
  canEdit,
  catalogs,
  sessions,
  snapshots,
}: {
  boatId: string;
  boatClass: string | null;
  canEdit: boolean;
  catalogs: BoatMetadataCatalogs;
  sessions: BoatSessionListItem[];
  snapshots: LatestSessionSnapshot[];
}) {
  const [pending, startTransition] = useTransition();
  const snapshotsByEntry = useMemo(
    () => new Map(snapshots.map((snap) => [snap.entryId, snap])),
    [snapshots],
  );

  const [crewForm, setCrewForm] = useState({
    displayName: "",
    defaultRole: "",
  });
  const [sailForm, setSailForm] = useState({ label: "", sailType: "" });
  const [setupForm, setSetupForm] = useState({ name: "", notes: "" });
  const [tagForm, setTagForm] = useState({ label: "" });

  const [snapshotEntryId, setSnapshotEntryId] = useState(
    sessions[0]?.entryId ?? "",
  );
  const [selectedCrewIds, setSelectedCrewIds] = useState<string[]>([]);
  const [selectedSailIds, setSelectedSailIds] = useState<string[]>([]);
  const [selectedSetupId, setSelectedSetupId] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [conditionForm, setConditionForm] = useState({
    seaState: "",
    currentNotes: "",
    notes: "",
  });

  function run(action: () => Promise<{ error: string | null }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });
  }

  function buildSnapshotPayload(): SessionMetadataPayloadV1 {
    const base = emptySessionMetadataPayload(boatClass);
    const crew = catalogs.crewPeople
      .filter((person) => selectedCrewIds.includes(person.id))
      .map((person) => ({
        personId: person.id,
        displayName: person.displayName,
        role: person.defaultRole ?? "",
      }));
    const sails = catalogs.sails
      .filter((sail) => selectedSailIds.includes(sail.id))
      .map((sail) => ({
        sailId: sail.id,
        label: sail.label,
        sailType: sail.sailType,
      }));
    const setupRow = catalogs.setups.find((row) => row.id === selectedSetupId);
    const sessionTags = catalogs.sessionTags
      .filter((tag) => selectedTagIds.includes(tag.id))
      .map((tag) => ({ tagDefId: tag.id, label: tag.label }));

    return {
      ...base,
      crew,
      sails,
      setup: setupRow
        ? {
            setupId: setupRow.id,
            name: setupRow.name,
            notes: setupRow.notes,
            fields: setupRow.fields,
          }
        : base.setup,
      sessionTags,
      conditions: {
        seaState: conditionForm.seaState.trim() || null,
        currentNotes: conditionForm.currentNotes.trim() || null,
        notes: conditionForm.notes.trim() || null,
        source: {
          kind: "manual",
          detail: "Boat Hub Setup tab",
        },
      },
    };
  }

  return (
    <section className="space-y-6" aria-labelledby="setup-heading">
      <div>
        <h2 id="setup-heading" className="text-lg font-semibold">
          Setup
        </h2>
        <p className="text-sm text-muted-foreground">
          Reusable catalogs and immutable Session snapshots. Later catalog edits
          do not rewrite frozen snapshot text.
        </p>
      </div>

      {!canEdit ? (
        <Card className="bg-card/70">
          <CardContent className="py-6 text-sm text-muted-foreground">
            You can view catalogs and snapshots. Editing requires boat editor
            access.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Crew people</CardTitle>
            <CardDescription>
              Sailing crew catalog — separate from membership login access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CatalogList
              empty="No crew people yet."
              items={catalogs.crewPeople.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div>
                    <p className="font-medium">{person.displayName}</p>
                    {person.defaultRole ? (
                      <p className="text-xs text-muted-foreground">
                        {person.defaultRole}
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            archiveBoatCrewPerson({
                              boatId,
                              personId: person.id,
                            }),
                          "Crew person archived.",
                        )
                      }
                    >
                      Archive
                    </Button>
                  ) : null}
                </li>
              ))}
            />
            {canEdit ? (
              <form
                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const result = await addBoatCrewPerson({
                      boatId,
                      ...crewForm,
                    });
                    if (!result.error) {
                      setCrewForm({ displayName: "", defaultRole: "" });
                    }
                    return result;
                  }, "Crew person added.");
                }}
              >
                <Input
                  placeholder="Display name"
                  value={crewForm.displayName}
                  onChange={(e) =>
                    setCrewForm({ ...crewForm, displayName: e.target.value })
                  }
                  required
                  className="h-11"
                />
                <Input
                  placeholder="Default role"
                  value={crewForm.defaultRole}
                  onChange={(e) =>
                    setCrewForm({ ...crewForm, defaultRole: e.target.value })
                  }
                  className="h-11"
                />
                <Button type="submit" disabled={pending} className="min-h-11">
                  Add
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Sails</CardTitle>
            <CardDescription>Inventory for Session snapshots.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CatalogList
              empty="No sails yet."
              items={catalogs.sails.map((sail) => (
                <li
                  key={sail.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{sail.label}</p>
                    {sail.sailType ? (
                      <Badge variant="outline">{sail.sailType}</Badge>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => archiveBoatSail({ boatId, sailId: sail.id }),
                          "Sail archived.",
                        )
                      }
                    >
                      Archive
                    </Button>
                  ) : null}
                </li>
              ))}
            />
            {canEdit ? (
              <form
                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const result = await addBoatSail({ boatId, ...sailForm });
                    if (!result.error) setSailForm({ label: "", sailType: "" });
                    return result;
                  }, "Sail added.");
                }}
              >
                <Input
                  placeholder="Label"
                  value={sailForm.label}
                  onChange={(e) =>
                    setSailForm({ ...sailForm, label: e.target.value })
                  }
                  required
                  className="h-11"
                />
                <select
                  value={sailForm.sailType}
                  onChange={(e) =>
                    setSailForm({ ...sailForm, sailType: e.target.value })
                  }
                  className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">Type (optional)</option>
                  {SAIL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <Button type="submit" disabled={pending} className="min-h-11">
                  Add
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Setups</CardTitle>
            <CardDescription>Named rig / setup presets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CatalogList
              empty="No setups yet."
              items={catalogs.setups.map((setup) => (
                <li
                  key={setup.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div>
                    <p className="font-medium">{setup.name}</p>
                    {setup.notes ? (
                      <p className="text-xs text-muted-foreground">{setup.notes}</p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            archiveBoatSetup({ boatId, setupId: setup.id }),
                          "Setup archived.",
                        )
                      }
                    >
                      Archive
                    </Button>
                  ) : null}
                </li>
              ))}
            />
            {canEdit ? (
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const result = await addBoatSetup({ boatId, ...setupForm });
                    if (!result.error) setSetupForm({ name: "", notes: "" });
                    return result;
                  }, "Setup added.");
                }}
              >
                <Input
                  placeholder="Setup name"
                  value={setupForm.name}
                  onChange={(e) =>
                    setSetupForm({ ...setupForm, name: e.target.value })
                  }
                  required
                  className="h-11"
                />
                <Input
                  placeholder="Notes (optional)"
                  value={setupForm.notes}
                  onChange={(e) =>
                    setSetupForm({ ...setupForm, notes: e.target.value })
                  }
                  className="h-11"
                />
                <Button type="submit" disabled={pending} className="min-h-11 w-fit">
                  Add setup
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Session tags</CardTitle>
            <CardDescription>Reusable event / Session labels.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CatalogList
              empty="No session tags yet."
              items={catalogs.sessionTags.map((tag) => (
                <li
                  key={tag.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <p className="font-medium">{tag.label}</p>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            archiveBoatSessionTagDef({
                              boatId,
                              tagDefId: tag.id,
                            }),
                          "Session tag archived.",
                        )
                      }
                    >
                      Archive
                    </Button>
                  ) : null}
                </li>
              ))}
            />
            {canEdit ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const result = await addBoatSessionTagDef({
                      boatId,
                      label: tagForm.label,
                    });
                    if (!result.error) setTagForm({ label: "" });
                    return result;
                  }, "Session tag added.");
                }}
              >
                <Input
                  placeholder="Tag label"
                  value={tagForm.label}
                  onChange={(e) => setTagForm({ label: e.target.value })}
                  required
                  className="h-11 min-w-[12rem] flex-1"
                />
                <Button type="submit" disabled={pending} className="min-h-11">
                  Add
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Attach Session snapshot</CardTitle>
          <CardDescription>
            Freeze the selected catalog items onto a Session entry. Snapshots are
            append-only revisions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Sessions on this boat yet. Import or create a Session first.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="snapshot-session">Session</Label>
                <select
                  id="snapshot-session"
                  value={snapshotEntryId}
                  onChange={(e) => setSnapshotEntryId(e.target.value)}
                  disabled={!canEdit}
                  className="flex h-11 w-full max-w-xl rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {sessions.map((session) => (
                    <option key={session.entryId} value={session.entryId}>
                      {session.name} · {sessionBadgeLabel(session.sessionType)} ·{" "}
                      {formatSessionDateTime(session.startsAt, session.timezone)}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="space-y-2" disabled={!canEdit}>
                <legend className="text-sm font-medium">Crew</legend>
                <div className="flex flex-wrap gap-2">
                  {catalogs.crewPeople.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No crew people.</p>
                  ) : (
                    catalogs.crewPeople.map((person) => {
                      const checked = selectedCrewIds.includes(person.id);
                      return (
                        <label
                          key={person.id}
                          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border/70 px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedCrewIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== person.id)
                                  : [...prev, person.id],
                              )
                            }
                          />
                          {person.displayName}
                        </label>
                      );
                    })
                  )}
                </div>
              </fieldset>

              <fieldset className="space-y-2" disabled={!canEdit}>
                <legend className="text-sm font-medium">Sails</legend>
                <div className="flex flex-wrap gap-2">
                  {catalogs.sails.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sails.</p>
                  ) : (
                    catalogs.sails.map((sail) => {
                      const checked = selectedSailIds.includes(sail.id);
                      return (
                        <label
                          key={sail.id}
                          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border/70 px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedSailIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== sail.id)
                                  : [...prev, sail.id],
                              )
                            }
                          />
                          {sail.label}
                        </label>
                      );
                    })
                  )}
                </div>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="snapshot-setup">Setup</Label>
                <select
                  id="snapshot-setup"
                  value={selectedSetupId}
                  onChange={(e) => setSelectedSetupId(e.target.value)}
                  disabled={!canEdit}
                  className="flex h-11 w-full max-w-md rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">None</option>
                  {catalogs.setups.map((setup) => (
                    <option key={setup.id} value={setup.id}>
                      {setup.name}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="space-y-2" disabled={!canEdit}>
                <legend className="text-sm font-medium">Session tags</legend>
                <div className="flex flex-wrap gap-2">
                  {catalogs.sessionTags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tags.</p>
                  ) : (
                    catalogs.sessionTags.map((tag) => {
                      const checked = selectedTagIds.includes(tag.id);
                      return (
                        <label
                          key={tag.id}
                          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border/70 px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedTagIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== tag.id)
                                  : [...prev, tag.id],
                              )
                            }
                          />
                          {tag.label}
                        </label>
                      );
                    })
                  )}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cond-sea">Sea state</Label>
                  <Input
                    id="cond-sea"
                    value={conditionForm.seaState}
                    onChange={(e) =>
                      setConditionForm({
                        ...conditionForm,
                        seaState: e.target.value,
                      })
                    }
                    disabled={!canEdit}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cond-current">Current notes</Label>
                  <Input
                    id="cond-current"
                    value={conditionForm.currentNotes}
                    onChange={(e) =>
                      setConditionForm({
                        ...conditionForm,
                        currentNotes: e.target.value,
                      })
                    }
                    disabled={!canEdit}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cond-notes">Condition notes</Label>
                  <Input
                    id="cond-notes"
                    value={conditionForm.notes}
                    onChange={(e) =>
                      setConditionForm({
                        ...conditionForm,
                        notes: e.target.value,
                      })
                    }
                    disabled={!canEdit}
                    className="h-11"
                  />
                </div>
              </div>

              {canEdit ? (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={pending || !snapshotEntryId}
                  onClick={() =>
                    run(
                      () =>
                        saveSessionMetadataSnapshotAction({
                          boatId,
                          entryId: snapshotEntryId,
                          payload: buildSnapshotPayload(),
                        }),
                      "Session snapshot saved.",
                    )
                  }
                >
                  {pending ? "Saving…" : "Save snapshot revision"}
                </Button>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Latest Session snapshots</CardTitle>
          <CardDescription>
            Most recent revision per Session entry for this boat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Sessions yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {sessions.slice(0, 40).map((session) => {
                const snap = snapshotsByEntry.get(session.entryId);
                return (
                  <li
                    key={session.entryId}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={sessionWorkspaceHref(session.sessionId, "overview")}
                          className="font-medium hover:text-primary"
                        >
                          {session.name}
                        </Link>
                        <Badge variant="outline">
                          {sessionBadgeLabel(session.sessionType)}
                        </Badge>
                      </div>
                      {snap ? (
                        <p className="text-xs text-muted-foreground">
                          rev {snap.revision} · crew {snap.payload.crew.length} ·
                          sails {snap.payload.sails.length}
                          {snap.payload.setup.name
                            ? ` · setup ${snap.payload.setup.name}`
                            : ""}
                          {snap.payload.conditions.seaState
                            ? ` · ${snap.payload.conditions.seaState}`
                            : ""}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No snapshot yet
                        </p>
                      )}
                    </div>
                    <Link
                      href={sessionWorkspaceHref(session.sessionId, "performance")}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Performance
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
