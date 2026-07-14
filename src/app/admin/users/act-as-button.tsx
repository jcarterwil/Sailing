"use client";

import { Eye } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { startImpersonation } from "@/app/admin/users/impersonation-actions";
import { Button } from "@/components/ui/button";

/** Admin control to start acting as a (non-admin) boat owner. */
export function ActAsOwnerButton({
  userId,
  label,
}: {
  userId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      title={`Act as ${label}`}
      onClick={() =>
        startTransition(async () => {
          try {
            await startImpersonation(userId);
          } catch (error) {
            if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) {
              throw error;
            }
            toast.error(
              error instanceof Error ? error.message : "Could not start.",
            );
          }
        })
      }
    >
      <Eye className="size-4" aria-hidden="true" />
      View as
    </Button>
  );
}
