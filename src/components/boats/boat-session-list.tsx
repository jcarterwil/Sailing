import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  dateNeedsReviewLabel,
  sessionNeedsDateReview,
  trackStatusLabel,
  type BoatSessionListItem,
} from "@/lib/boats/boat-sessions";
import {
  formatSessionDateTime,
  sessionBadgeLabel,
} from "@/lib/sessions/format";

export function BoatSessionList({
  sessions,
  emptyMessage,
}: {
  sessions: BoatSessionListItem[];
  emptyMessage: string;
}) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="divide-y divide-border/60">
      {sessions.map((session) => (
        <li
          key={session.entryId}
          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/races/${session.sessionId}`}
                className="font-medium hover:text-primary"
              >
                {session.name}
              </Link>
              <Badge variant="outline">{sessionBadgeLabel(session.sessionType)}</Badge>
            </div>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatSessionDateTime(session.startsAt, session.timezone)}
              {session.venue ? ` · ${session.venue}` : ""}
            </p>
            {sessionNeedsDateReview(session.startsAtSource) ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {dateNeedsReviewLabel()}
              </p>
            ) : null}
          </div>
          <Badge
            variant={session.trackStatus === "processed" ? "secondary" : "outline"}
            className="w-fit"
          >
            {trackStatusLabel(session.trackStatus)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
