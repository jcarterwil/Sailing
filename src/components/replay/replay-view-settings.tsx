"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Settings2 } from "lucide-react";

import type {
  CameraMode,
  TrackLength,
} from "@/components/replay/playback-store";
import { isCompactReplayChrome as matchesCompactReplayChrome } from "@/components/replay/replay-safe-zones";
import type { ReplayDisplayPreferences } from "@/components/replay/replay-display-preferences";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type DisplayPreferencesPatch =
  Partial<ReplayDisplayPreferences>;

export function ViewSettingsFields({
  preferences,
  onPreferencesChange,
  trackLength,
  onTrackLengthChange,
  cameraMode,
  onCameraModeChange,
  hasSelection,
}: {
  preferences: ReplayDisplayPreferences;
  onPreferencesChange: (
    patch: DisplayPreferencesPatch,
  ) => void;
  trackLength: TrackLength;
  onTrackLengthChange: (length: TrackLength) => void;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  hasSelection: boolean;
}) {
  return (
    <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
      <div className="grid gap-1">
        <span className="text-xs font-medium sm:sr-only">
          Replay view
        </span>
        <Select
          value={preferences.viewMode}
          onValueChange={(value) =>
            onPreferencesChange({
              viewMode:
                value as ReplayDisplayPreferences["viewMode"],
            })
          }
        >
          <SelectTrigger
            className="h-11 w-full sm:h-9 sm:w-36"
            aria-label="Replay view"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tactical">Tactical</SelectItem>
            <SelectItem value="broadcast">
              Broadcast 3D
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {preferences.viewMode === "tactical" ? (
        <>
          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Track length
            </span>
            <Select
              value={trackLength}
              onValueChange={(value) =>
                onTrackLengthChange(value as TrackLength)
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-28"
                aria-label="Track length"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tail">60 s tail</SelectItem>
                <SelectItem value="full">
                  Full elapsed
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Track color
            </span>
            <Select
              value={preferences.trackMetric}
              onValueChange={(value) =>
                onPreferencesChange({
                  trackMetric:
                    value as ReplayDisplayPreferences["trackMetric"],
                })
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-32"
                aria-label="Track color"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boat">Boat</SelectItem>
                <SelectItem value="speed">Speed</SelectItem>
                <SelectItem value="vmg">VMG</SelectItem>
                <SelectItem value="pointing">Pointing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Track boats
            </span>
            <Select
              value={
                hasSelection ? preferences.trackScope : "all"
              }
              onValueChange={(value) =>
                onPreferencesChange({
                  trackScope:
                    value as ReplayDisplayPreferences["trackScope"],
                })
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-36"
                aria-label="Track boats"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All boats</SelectItem>
                <SelectItem value="selected" disabled={!hasSelection}>
                  {hasSelection
                    ? "Selected boat"
                    : "Select a boat first"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Base map
            </span>
            <Select
              value={preferences.baseStyle}
              onValueChange={(value) =>
                onPreferencesChange({
                  baseStyle:
                    value as ReplayDisplayPreferences["baseStyle"],
                })
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-28"
                aria-label="Base map"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="map">Map</SelectItem>
                <SelectItem value="satellite">
                  Satellite
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Nautical chart
            </span>
            <Select
              value={
                preferences.nauticalChart ? "on" : "off"
              }
              onValueChange={(value) =>
                onPreferencesChange({
                  nauticalChart: value === "on",
                })
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-32"
                aria-label="Nautical chart"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">
                  Chart off
                </SelectItem>
                <SelectItem value="on">
                  NOAA chart
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {preferences.nauticalChart ? (
            <label className="grid min-w-44 gap-1 text-xs font-medium">
              <span>
                Chart opacity{" "}
                {Math.round(
                  preferences.chartOpacity * 100,
                )}
                %
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={preferences.chartOpacity}
                onChange={(event) =>
                  onPreferencesChange({
                    chartOpacity: Number(
                      event.currentTarget.value,
                    ),
                  })
                }
                className="h-11 w-full accent-primary sm:h-9"
                aria-label="Nautical chart opacity"
              />
            </label>
          ) : null}

          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Tactical boats
            </span>
            <Select
              value={
                preferences.showTacticalHulls
                  ? "hulls"
                  : "arrows"
              }
              onValueChange={(value) =>
                onPreferencesChange({
                  showTacticalHulls: value === "hulls",
                })
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-36"
                aria-label="Tactical boats"
                title="Stylized hulls appear at close zoom; arrows remain the fleet fallback"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="arrows">
                  Boat arrows
                </SelectItem>
                <SelectItem value="hulls">
                  Stylized hulls
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium sm:sr-only">
              Tactical camera
            </span>
            <Select
              value={cameraMode}
              onValueChange={(value) =>
                onCameraModeChange(value as CameraMode)
              }
            >
              <SelectTrigger
                className="h-11 w-full sm:h-9 sm:w-28"
                aria-label="Tactical camera"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fleet">
                  Fleet auto
                </SelectItem>
                <SelectItem value="north">
                  North-up
                </SelectItem>
                <SelectItem
                  value="follow"
                  disabled={!hasSelection}
                >
                  Follow
                </SelectItem>
                <SelectItem
                  value="chase"
                  disabled={!hasSelection}
                >
                  Chase
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <div className="grid gap-1">
          <span className="text-xs font-medium sm:sr-only">
            Broadcast camera
          </span>
          <Select
            value={preferences.broadcastCamera}
            onValueChange={(value) =>
              onPreferencesChange({
                broadcastCamera:
                  value as ReplayDisplayPreferences["broadcastCamera"],
              })
            }
          >
            <SelectTrigger
              className="h-11 w-full sm:h-9 sm:w-36"
              aria-label="Broadcast camera"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chase">Chase</SelectItem>
              <SelectItem value="aerial">
                Fleet aerial
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function isCompactReplayChrome(): boolean {
  if (typeof window === "undefined") return false;
  return matchesCompactReplayChrome({
    widthPx: window.innerWidth,
    heightPx: window.innerHeight,
    landscape: window.matchMedia("(orientation: landscape)")
      .matches,
  });
}

/**
 * Desktop inline settings + mobile/landscape bottom Sheet.
 * Opening the sheet must not pause playback. Orientation /
 * resize into desktop chrome closes an open sheet so it is
 * not stranded without a visible trigger.
 */
export function ReplayViewSettings({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (!isCompactReplayChrome()) setOpen(false);
    };
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  return (
    <>
      <div
        className="hidden min-w-0 sm:block"
        data-replay-desktop-settings
      >
        {children}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="ml-auto size-11 shrink-0 sm:hidden"
            data-replay-mobile-settings
            aria-label="Open View settings"
          >
            <Settings2 className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[82dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>View settings</SheetTitle>
            <SheetDescription>
              Choose the replay renderer, chart, trails,
              boats, and camera without pausing playback.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
