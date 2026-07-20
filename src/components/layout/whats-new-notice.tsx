"use client";

import { Sparkles } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CHANGELOG_ENTRIES,
  WHATS_NEW_LAST_SEEN_KEY,
  formatChangelogDate,
  getLatestChangelogId,
  hasUnreadChangelog,
  type ChangelogEntry,
} from "@/lib/changelog";

const WHATS_NEW_STORAGE_EVENT = "sailing:whats-new-storage";

function readLastSeenId(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeenId(id: string): void {
  try {
    window.localStorage.setItem(WHATS_NEW_LAST_SEEN_KEY, id);
    window.dispatchEvent(new Event(WHATS_NEW_STORAGE_EVENT));
  } catch {
    // Ignore quota / private-mode failures; the notice still works without persistence.
  }
}

function subscribeLastSeen(onStoreChange: () => void): () => void {
  const onChange = () => onStoreChange();
  window.addEventListener("storage", onChange);
  window.addEventListener(WHATS_NEW_STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WHATS_NEW_STORAGE_EVENT, onChange);
  };
}

/** Header control that lists recent product changes from the changelog. */
export function WhatsNewNotice({
  entries = CHANGELOG_ENTRIES,
}: {
  entries?: readonly ChangelogEntry[];
}) {
  const [open, setOpen] = useState(false);
  const latestId = getLatestChangelogId(entries);
  // SSR/hydration pretends the latest entry is already seen so the unread
  // dot only appears after the client reads localStorage (no mismatch flash).
  const lastSeenId = useSyncExternalStore(
    subscribeLastSeen,
    readLastSeenId,
    () => latestId,
  );
  const unread = hasUnreadChangelog(lastSeenId, entries);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && latestId) {
      writeLastSeenId(latestId);
    }
  }

  if (entries.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-11"
          aria-label={unread ? "What's new (unread updates)" : "What's new"}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {unread ? (
            <span
              className="absolute top-2.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-background"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0"
      >
        <PopoverHeader className="border-b border-border/70 px-3 py-2.5">
          <PopoverTitle>What&apos;s new</PopoverTitle>
          <PopoverDescription>
            Recent product changes, summarized from shipped GitHub work.
          </PopoverDescription>
        </PopoverHeader>
        <ul className="max-h-[min(24rem,70vh)] overflow-y-auto p-1.5" role="list">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md px-2.5 py-2.5 text-left hover:bg-muted/60"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-foreground">{entry.title}</p>
                <time
                  dateTime={entry.date}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatChangelogDate(entry.date)}
                </time>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {entry.summary}
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
