"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, UserCog } from "lucide-react";

import {
  updateUserAdminAccess,
  updateUserBoatAccess,
} from "@/app/admin/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BoatCrewRole } from "@/lib/users/access";

interface AccessBoat {
  id: string;
  name: string;
  ownerId: string | null;
}

interface UserAccessEditorProps {
  userId: string;
  userLabel: string;
  currentUserId: string;
  initialIsAdmin: boolean;
  initialBoatAccess: Record<string, BoatCrewRole>;
  boats: AccessBoat[];
}

export function UserAccessEditor({
  userId,
  userLabel,
  currentUserId,
  initialIsAdmin,
  initialBoatAccess,
  boats,
}: UserAccessEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isCurrentUser = currentUserId === userId;
  const isAdmin = initialIsAdmin;
  const boatAccess = initialBoatAccess;

  function run(action: () => Promise<void>, success: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await action();
        setNotice(success);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update user access.");
      }
    });
  }

  function changeAdminAccess() {
    const makeAdmin = !isAdmin;
    if (!makeAdmin && !window.confirm(`Remove administrator access from ${userLabel}?`)) return;
    run(
      () => updateUserAdminAccess(userId, makeAdmin),
      makeAdmin ? "Administrator access granted." : "Administrator access removed.",
    );
  }

  function changeBoatAccess(boatId: string, value: string) {
    const role = value === "none" ? null : (value as BoatCrewRole);
    run(
      () => updateUserBoatAccess(userId, boatId, role),
      role ? `Boat access changed to ${role}.` : "Boat access removed.",
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <UserCog className="size-3.5" aria-hidden="true" />
          Edit access
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit access for {userLabel}</DialogTitle>
          <DialogDescription>
            Changes apply immediately. Boat ownership is managed separately.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3 rounded-lg border border-border/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Global role</h3>
              <p className="text-xs text-muted-foreground">
                Administrators can manage every race, boat, user, and crew roster.
              </p>
            </div>
            <Badge variant={isAdmin ? "default" : "outline"} className="gap-1">
              {isAdmin && <ShieldCheck className="size-3" aria-hidden="true" />}
              {isAdmin ? "Administrator" : "Standard user"}
            </Badge>
          </div>
          <Button
            type="button"
            variant={isAdmin ? "outline" : "default"}
            disabled={pending || (isCurrentUser && isAdmin)}
            onClick={changeAdminAccess}
          >
            {isAdmin ? "Remove administrator" : "Make administrator"}
          </Button>
          {isCurrentUser && isAdmin && (
            <p className="text-xs text-muted-foreground">
              You cannot remove your own administrator access.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="font-medium">Boat access</h3>
            <p className="text-xs text-muted-foreground">
              Administrators inherit access to every boat; assignments below remain available if
              the administrator role is later removed.
            </p>
          </div>
          {boats.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              No boats are available.
            </p>
          ) : (
            <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
              {boats.map((boat) => {
                const isOwner = boat.ownerId === userId;
                return (
                  <li key={boat.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{boat.name}</p>
                      {isOwner && <p className="text-xs text-muted-foreground">Boat owner</p>}
                    </div>
                    {isOwner ? (
                      <Badge>Owner</Badge>
                    ) : (
                      <Select
                        value={boatAccess[boat.id] ?? "none"}
                        disabled={pending}
                        onValueChange={(value) => changeBoatAccess(boat.id, value)}
                      >
                        <SelectTrigger
                          className="w-32"
                          aria-label={`Access to ${boat.name} for ${userLabel}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
