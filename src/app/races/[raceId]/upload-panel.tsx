"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, FileUp, Loader2 } from "lucide-react";

import { createEntryFromFile, requestTrackUpload } from "@/app/races/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface EntryRow {
  entryId: string;
  boatName: string;
  color: string;
  canUpload: boolean;
  track: {
    id: string;
    status: string;
    errorMessage: string | null;
    pointCount: number | null;
    filename: string;
  } | null;
}

interface UploadState {
  label: string;
  phase: "uploading" | "processing" | "done" | "error";
  detail?: string;
}

export function UploadPanel({
  raceId,
  isOrganizer,
  entries,
}: {
  raceId: string;
  isOrganizer: boolean;
  entries: EntryRow[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const entryUploadRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [targetEntry, setTargetEntry] = useState<string | null>(null);

  const anyPending = entries.some(
    (e) => e.track && (e.track.status === "uploaded" || e.track.status === "processing"),
  );

  // Refresh server-rendered statuses while anything is still processing.
  useEffect(() => {
    if (!anyPending) return;
    const interval = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(interval);
  }, [anyPending, router]);

  const uploadFile = useCallback(
    async (file: File, entryId?: string) => {
      const key = entryId ?? file.name;
      setUploads((u) => ({ ...u, [key]: { label: file.name, phase: "uploading" } }));
      try {
        const targetEntryId =
          entryId ?? (await createEntryFromFile(raceId, file.name)).entryId;
        const grant = await requestTrackUpload(targetEntryId, file.name, file.size);
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from("race-tracks-raw")
          .uploadToSignedUrl(grant.path, grant.token, file, { upsert: true });
        if (uploadError) throw new Error(uploadError.message);

        setUploads((u) => ({ ...u, [key]: { label: file.name, phase: "processing" } }));
        const res = await fetch(`/api/tracks/${grant.trackId}/process`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Processing failed.");

        setUploads((u) => ({
          ...u,
          [key]: {
            label: file.name,
            phase: "done",
            detail: `${body.pointCount.toLocaleString()} points`,
          },
        }));
      } catch (err) {
        setUploads((u) => ({
          ...u,
          [key]: {
            label: file.name,
            phase: "error",
            detail: err instanceof Error ? err.message : "Upload failed.",
          },
        }));
      }
      router.refresh();
    },
    [raceId, router],
  );

  async function handleBulkFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }

  async function handleEntryFile(files: FileList | null) {
    if (!files || files.length === 0 || !targetEntry) return;
    await uploadFile(files[0], targetEntry);
    setTargetEntry(null);
  }

  return (
    <div className="space-y-4">
      {isOrganizer && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".vkx,.csv"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleBulkFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="size-4" aria-hidden="true" />
            Upload track files
          </Button>
        </div>
      )}
      <input
        ref={entryUploadRef}
        type="file"
        accept=".vkx,.csv"
        className="hidden"
        onChange={(e) => {
          void handleEntryFile(e.target.files);
          e.target.value = "";
        }}
      />

      {Object.entries(uploads).length > 0 && (
        <ul className="space-y-1 text-sm">
          {Object.entries(uploads).map(([key, u]) => (
            <li key={key} className="flex items-center gap-2">
              {u.phase === "done" ? (
                <CheckCircle2 className="size-4 text-green-500" aria-hidden="true" />
              ) : u.phase === "error" ? (
                <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
              ) : (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              <span>{u.label}</span>
              <span className="text-muted-foreground">
                {u.phase === "uploading" && "uploading…"}
                {u.phase === "processing" && "processing…"}
                {u.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
        {entries.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No boats yet.{" "}
            {isOrganizer ? "Upload track files to add the fleet." : "Ask the organizer to add you."}
          </li>
        )}
        {entries.map((entry) => (
          <li key={entry.entryId} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-medium">{entry.boatName}</span>
            {entry.track ? (
              <>
                <TrackStatusBadge status={entry.track.status} />
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {entry.track.status === "error"
                    ? entry.track.errorMessage
                    : entry.track.pointCount
                      ? `${entry.track.pointCount.toLocaleString()} pts`
                      : entry.track.filename}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">no track</span>
            )}
            {entry.canUpload && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTargetEntry(entry.entryId);
                  entryUploadRef.current?.click();
                }}
              >
                {entry.track ? "Replace" : "Upload"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrackStatusBadge({ status }: { status: string }) {
  if (status === "processed") return <Badge variant="secondary">processed</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
