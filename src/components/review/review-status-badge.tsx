import { BadgeCheck, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { reviewBadgeLabel } from "@/lib/review/findings";

/** Spec §5.3: auto-publish with a visible review state on every report surface. */
export function ReviewStatusBadge({ openCount }: { openCount: number }) {
  const reviewed = openCount === 0;
  return (
    <Badge variant={reviewed ? "default" : "secondary"}>
      {reviewed ? (
        <BadgeCheck className="size-3" aria-hidden="true" />
      ) : (
        <ListTodo className="size-3" aria-hidden="true" />
      )}
      {reviewBadgeLabel(openCount)}
    </Badge>
  );
}
