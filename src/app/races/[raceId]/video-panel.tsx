"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Film,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";

import {
  confirmVideoUpload,
  deleteRaceVideo,
  markVideoUploadError,
  requestVideoReadUrl,
  requestVideoUpload,
  setManualVideoTiming,
} from "@/app/races/video-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { uploadVideoWithProgress } from "@/lib/videos/upload-client";
import { validateVideoUpload } from "@/lib/videos/upload";

interface VideoRow {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  entryName: string | null;
  canManage: boolean;
  uploadConfirmed: boolean;
  startUtcMs: number | null;
  durationMs: number | null;
  timingProvenance: string | null;
  lastErrorMessage: string | null;
}

interface UploadState {
  label: string;
  phase: "uploading" | "confirming" | "done" | "error";
  percent: number;
  detail?: string;
}

function safeClientError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Video operation failed.";
  if (
    message.startsWith("Only .mp4") ||
    message.startsWith("The selected") ||
    message.startsWith("Video exceeds") ||
    message.startsWith("Choose a video") ||
    message.startsWith("You may attach") ||
    message.startsWith("Only the uploader") ||
    message.startsWith("Video upload") ||
    message.startsWith("The uploaded") ||
    message.startsWith("The stored") ||
    message.startsWith("Could not") ||
    message.startsWith("Video not found") ||
    message.startsWith("Enter a valid") ||
    message.startsWith("Enter a positive")
  ) {
    return message;
  }
  return "Video operation failed. Please retry.";
}

export function VideoPanel({ raceId, videos }: { raceId: string; videos: VideoRow[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [replaceVideoId, setReplaceVideoId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);
  const [manualVideoId, setManualVideoId] = useState<string | null>(null);
  const [manualStartUtc, setManualStartUtc] = useState("");
  const [manualDurationMs, setManualDurationMs] = useState("");

  async function uploadFile(file: File, replacingId: string | null) {
    setUpload({ label: file.name, phase: "uploading", percent: 0 });
    let grantedVideoId: string | null = null;
    let putCompleted = false;
    try {
      const validated = validateVideoUpload({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const grant = await requestVideoUpload(raceId, {
        filename: validated.filename,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
      });
      grantedVideoId = grant.videoId;
      await uploadVideoWithProgress({
        signedUrl: grant.signedUrl,
        file,
        onProgress: (percent) =>
          setUpload((current) =>
            current ? { ...current, phase: "uploading", percent } : current,
          ),
      });
      putCompleted = true;
      setUpload((current) =>
        current ? { ...current, phase: "confirming", percent: 100 } : current,
      );
      await confirmVideoUpload(grant.videoId);

      let detail = "Upload complete.";
      if (replacingId) {
        try {
          await deleteRaceVideo(replacingId);
          detail = "Replacement complete.";
        } catch {
          detail = "New video uploaded; the previous video was retained.";
        }
      }
      setUpload({ label: file.name, phase: "done", percent: 100, detail });
    } catch (error) {
      // Only mark upload_failed when the PUT itself failed. Confirmation
      // failures leave the object in place so the user can retry verify.
      if (grantedVideoId && !putCompleted) {
        try {
          await markVideoUploadError(grantedVideoId);
        } catch {
          // The server records operational details. Keep the client error sanitized.
        }
      }
      setUpload({
        label: file.name,
        phase: "error",
        percent: 0,
        detail: safeClientError(error),
      });
    } finally {
      setReplaceVideoId(null);
      router.refresh();
    }
  }

  async function openVideo(videoId: string) {
    setBusyVideoId(videoId);
    try {
      const { signedUrl } = await requestVideoReadUrl(videoId);
      const link = document.createElement("a");
      link.href = signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (error) {
      setUpload({
        label: "Video",
        phase: "error",
        percent: 0,
        detail: safeClientError(error),
      });
    } finally {
      setBusyVideoId(null);
    }
  }


  async function processVideo(videoId: string) {
    setBusyVideoId(videoId);
    try {
      const response = await fetch(`/api/videos/${videoId}/process`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not process video.");
      router.refresh();
    } catch (error) {
      setUpload({ label: "Process video", phase: "error", percent: 0, detail: safeClientError(error) });
      router.refresh();
    } finally {
      setBusyVideoId(null);
    }
  }

  async function saveManualTiming(videoId: string) {
    setBusyVideoId(videoId);
    try {
      await setManualVideoTiming(videoId, {
        startUtc: manualStartUtc,
        durationMs: Number(manualDurationMs),
      });
      setManualVideoId(null);
      router.refresh();
    } catch (error) {
      setUpload({ label: "Manual alignment", phase: "error", percent: 0, detail: safeClientError(error) });
    } finally {
      setBusyVideoId(null);
    }
  }

  async function removeVideo(videoId: string) {
    setBusyVideoId(videoId);
    try {
      await deleteRaceVideo(videoId);
      router.refresh();
    } catch (error) {
      setUpload({
        label: "Delete video",
        phase: "error",
        percent: 0,
        detail: safeClientError(error),
      });
    } finally {
      setBusyVideoId(null);
    }
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file, replaceVideoId);
          event.target.value = "";
        }}
      />

      <Button
        variant="outline"
        disabled={upload?.phase === "uploading" || upload?.phase === "confirming"}
        onClick={() => {
          setReplaceVideoId(null);
          fileInputRef.current?.click();
        }}
      >
        <Upload className="size-4" aria-hidden="true" />
        Upload action-camera video
      </Button>

      {upload && (
        <div className="rounded-lg border border-border/70 p-3 text-sm" aria-live="polite">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {upload.phase === "done" ? (
              <CheckCircle2 className="size-4 shrink-0 text-green-500" aria-hidden="true" />
            ) : upload.phase === "error" ? (
              <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{upload.label}</span>
            <span className="w-full text-muted-foreground sm:ml-auto sm:w-auto sm:shrink-0">
              {upload.phase === "uploading" && `${upload.percent}%`}
              {upload.phase === "confirming" && "verifying…"}
              {(upload.phase === "done" || upload.phase === "error") && upload.detail}
            </span>
          </div>
          {(upload.phase === "uploading" || upload.phase === "confirming") && (
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Video upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={upload.percent}
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${upload.percent}%` }}
              />
            </div>
          )}
        </div>
      )}


      {manualVideoId && (
        <div className="rounded-lg border border-border/70 p-3 text-sm">
          <p className="font-medium">Manual UTC alignment</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
            <input
              className="rounded-md border bg-background px-3 py-2"
              aria-label="Video start time in UTC"
              placeholder="2026-07-13T15:00:00.000Z"
              value={manualStartUtc}
              onChange={(event) => setManualStartUtc(event.target.value)}
            />
            <input
              className="rounded-md border bg-background px-3 py-2"
              aria-label="Video duration in milliseconds"
              placeholder="duration ms"
              inputMode="numeric"
              value={manualDurationMs}
              onChange={(event) => setManualDurationMs(event.target.value)}
            />
            <Button
              size="sm"
              disabled={busyVideoId === manualVideoId}
              onClick={() => void saveManualTiming(manualVideoId)}
            >
              Save alignment
            </Button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
        {videos.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No action-camera videos have been uploaded.
          </li>
        )}
        {videos.map((video) => (
          <li key={video.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <Film className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{video.filename}</p>
              <p className="text-xs text-muted-foreground">
                {video.entryName ? `${video.entryName} · ` : ""}
                {new Date(video.createdAt).toLocaleString()}
              </p>
              {video.startUtcMs && video.durationMs && (
                <p className="text-xs text-muted-foreground">
                  {new Date(video.startUtcMs).toISOString()} · {Math.round(video.durationMs / 1000)}s · {video.timingProvenance}
                </p>
              )}
              {video.status === "error" && video.lastErrorMessage && (
                <p className="text-xs text-destructive">{video.lastErrorMessage}</p>
              )}
            </div>
            <Badge variant={video.uploadConfirmed ? "secondary" : "outline"}>
              {video.uploadConfirmed
                ? video.status
                : video.status === "error"
                  ? "upload error"
                  : "upload incomplete"}
            </Badge>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!video.uploadConfirmed || busyVideoId === video.id}
                onClick={() => void openVideo(video.id)}
              >
                {busyVideoId === video.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ExternalLink className="size-4" aria-hidden="true" />
                )}
                View
              </Button>
              {video.canManage && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!video.uploadConfirmed || busyVideoId === video.id}
                    onClick={() => void processVideo(video.id)}
                  >
                    <Loader2 className={busyVideoId === video.id ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
                    Process
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!video.uploadConfirmed || busyVideoId === video.id}
                    onClick={() => {
                      setManualVideoId(video.id);
                      setManualStartUtc(video.startUtcMs ? new Date(video.startUtcMs).toISOString() : "");
                      setManualDurationMs(video.durationMs ? String(video.durationMs) : "");
                    }}
                  >
                    <SlidersHorizontal className="size-4" aria-hidden="true" />
                    Align
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyVideoId === video.id}
                    onClick={() => {
                      setReplaceVideoId(video.id);
                      fileInputRef.current?.click();
                    }}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Replace
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={busyVideoId === video.id}>
                        <Trash2 className="size-4" aria-hidden="true" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this video?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the private video and its metadata. This action
                          cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void removeVideo(video.id)}>
                          Delete video
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
