"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import type {
  BroadcastRenderer,
  BroadcastRendererFailure,
  BroadcastTelemetry,
} from "@/components/replay/broadcast-3d-renderer";
import type { BroadcastQualityPreference } from "@/components/replay/broadcast-quality";
import type { BroadcastCamera } from "@/components/replay/replay-display-preferences";
import type { ReplayRenderFrameSource } from "@/components/replay/replay-render-source";

export type Broadcast3dFailure = BroadcastRendererFailure;

export interface Broadcast3dProps {
  source: ReplayRenderFrameSource;
  cameraMode?: BroadcastCamera;
  quality?: BroadcastQualityPreference;
  onFailure: (failure: Broadcast3dFailure) => void;
  onTelemetry?: (telemetry: BroadcastTelemetry) => void;
  className?: string;
}

/**
 * Lazy standalone Broadcast 3D boundary. Three.js is imported only after this
 * component mounts, and every draw is driven by ReplayRenderFrameSource (plus
 * one forced draw on init/resize/visibility return). It never owns a clock.
 */
export function Broadcast3d({
  source,
  cameraMode = "chase",
  quality = "auto",
  onFailure,
  onTelemetry,
  className,
}: Broadcast3dProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricRef = useRef<HTMLSpanElement>(null);
  const rendererRef = useRef<BroadcastRenderer | null>(null);
  const onFailureRef = useRef(onFailure);
  const onTelemetryRef = useRef(onTelemetry);
  const cameraModeRef = useRef(cameraMode);
  const qualityRef = useRef(quality);
  const [status, setStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [failureMessage, setFailureMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    onFailureRef.current = onFailure;
    onTelemetryRef.current = onTelemetry;
  }, [onFailure, onTelemetry]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let cancelled = false;
    let failureReported = false;
    let renderer: BroadcastRenderer | null = null;
    let unsubscribeSource = () => {};
    let resizeObserver: ResizeObserver | null = null;
    let removeVisibilityListener = () => {};
    let normalizeFailure:
      | ((cause: unknown) => BroadcastRendererFailure)
      | null = null;

    const teardown = () => {
      const activeRenderer = renderer;
      renderer = null;
      unsubscribeSource();
      unsubscribeSource = () => {};
      resizeObserver?.disconnect();
      resizeObserver = null;
      removeVisibilityListener();
      removeVisibilityListener = () => {};
      if (rendererRef.current === activeRenderer) {
        rendererRef.current = null;
      }
      activeRenderer?.dispose();
    };

    const reportFailure = (failure: BroadcastRendererFailure) => {
      if (cancelled || failureReported) return;
      failureReported = true;
      setFailureMessage(failure.message);
      setStatus("failed");
      teardown();
      onFailureRef.current(failure);
    };

    void Promise.all([
      import("three"),
      import("@/components/replay/broadcast-3d-renderer"),
    ])
      .then(([THREE, rendererModule]) => {
        if (cancelled) return;
        normalizeFailure = rendererModule.normalizeBroadcastRendererFailure;

        renderer = rendererModule.createBroadcastRenderer(THREE, {
          canvas,
          cameraMode: cameraModeRef.current,
          qualityPreference: qualityRef.current,
          onFailure: reportFailure,
          onTelemetry: (telemetry) => {
            root.dataset.broadcastQuality = telemetry.qualityTier;
            root.dataset.broadcastFrameMs =
              telemetry.averageRenderMs.toFixed(1);
            if (metricRef.current) {
              metricRef.current.textContent =
                telemetry.qualityTier +
                " · " +
                telemetry.averageRenderMs.toFixed(1) +
                " ms";
            }
            onTelemetryRef.current?.(telemetry);
          },
        });
        rendererRef.current = renderer;

        const resize = () => {
          if (!renderer || cancelled) return;
          renderer.resize(
            Math.max(1, root.clientWidth),
            Math.max(1, root.clientHeight),
            window.devicePixelRatio,
          );
          renderer.renderFrame(source.frameRef.current, {
            force: true,
          });
        };

        unsubscribeSource = source.subscribe((frame) => {
          renderer?.renderFrame(frame);
        });
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(root);

        const applyVisibility = () => {
          if (!renderer || cancelled) return;
          const isVisible = document.visibilityState !== "hidden";
          renderer.setVisible(isVisible);
          if (isVisible) {
            renderer.renderFrame(source.frameRef.current, {
              force: true,
            });
          }
        };
        document.addEventListener(
          "visibilitychange",
          applyVisibility,
        );
        removeVisibilityListener = () => {
          document.removeEventListener(
            "visibilitychange",
            applyVisibility,
          );
        };

        resize();
        applyVisibility();
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        const failure =
          normalizeFailure?.(cause) ?? {
            code: "initialization-failed" as const,
            message:
              cause instanceof Error
                ? cause.message
                : "Could not initialize Broadcast 3D.",
            cause,
          };
        reportFailure(failure);
      });

    return () => {
      cancelled = true;
      teardown();
    };
  }, [source]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setCameraMode(cameraMode);
    renderer.renderFrame(source.frameRef.current, { force: true });
  }, [cameraMode, source]);

  useEffect(() => {
    qualityRef.current = quality;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setQualityPreference(quality);
    renderer.renderFrame(source.frameRef.current, { force: true });
  }, [quality, source]);

  return (
    <div
      ref={rootRef}
      className={[
        "absolute inset-0 overflow-hidden bg-sky-200",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-broadcast-view="1"
      data-broadcast-status={status}
    >
      <canvas
        ref={canvasRef}
        className="block size-full"
        aria-label="Broadcast 3D sailing race replay"
      />

      {status === "loading" ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-sky-100 text-sm text-sky-950"
          role="status"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          Loading Broadcast 3D…
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
          Broadcast 3D · <span ref={metricRef}>measuring…</span>
        </div>
      ) : null}

      {status === "failed" ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background/90 p-6 text-center text-sm text-destructive"
          role="alert"
        >
          Broadcast 3D unavailable
          {failureMessage ? ": " + failureMessage : "."}
        </div>
      ) : null}
    </div>
  );
}
