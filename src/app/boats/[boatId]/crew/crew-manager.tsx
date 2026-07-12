"use client";

import { useState, useTransition } from "react";
import { Mail, Plus, Trash2 } from "lucide-react";

import {
  inviteCrewMember,
  removeCrewMember,
  resendCrewInvite,
  updateCrewRole,
} from "@/app/boats/crew-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountStatusLabel, type AccountStatus, type BoatCrewRole } from "@/lib/users/access";

export interface CrewRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: BoatCrewRole;
  status: AccountStatus;
  addedAt: string;
}

function InviteCrewDialog({ boatId }: { boatId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BoatCrewRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setRole("viewer");
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          Invite crew
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite crew member</DialogTitle>
          <DialogDescription>
            Existing users get access immediately. New users receive an email invitation.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              try {
                await inviteCrewMember(boatId, email, role);
                reset();
                setOpen(false);
              } catch (err) {
                if (err instanceof Error) setError(err.message);
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="crew-email">Email</Label>
            <Input
              id="crew-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="crew@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crew-role">Access</Label>
            <Select value={role} onValueChange={(value) => setRole(value as BoatCrewRole)}>
              <SelectTrigger id="crew-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer — read-only</SelectItem>
                <SelectItem value="editor">Editor — upload and edit boat data</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Inviting…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CrewManager({ boatId, rows }: { boatId: string; rows: CrewRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(action: () => Promise<void>, success: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await action();
        setNotice(success);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Crew access is boat-specific; it does not grant race-organizer or owner privileges.
        </p>
        <InviteCrewDialog boatId={boatId} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
          No crew logins yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
          {rows.map((row) => (
            <li key={row.userId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-52 flex-1">
                <p className="font-medium">{row.displayName ?? row.email}</p>
                {row.displayName && <p className="text-xs text-muted-foreground">{row.email}</p>}
              </div>
              <Badge variant={row.status === "active" ? "secondary" : "outline"}>
                {accountStatusLabel(row.status)}
              </Badge>
              <Select
                value={row.role}
                disabled={pending}
                onValueChange={(value) =>
                  run(
                    () => updateCrewRole(boatId, row.userId, value as BoatCrewRole),
                    "Access updated.",
                  )
                }
              >
                <SelectTrigger className="w-32" aria-label={`Access for ${row.email}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                </SelectContent>
              </Select>
              {row.status === "invited" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => resendCrewInvite(boatId, row.userId), "Invitation resent.")
                  }
                >
                  <Mail className="size-3.5" aria-hidden="true" />
                  Resend
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Remove ${row.email}`}
                onClick={() => {
                  if (!window.confirm(`Remove ${row.email} from this boat?`)) return;
                  run(() => removeCrewMember(boatId, row.userId), "Crew access removed.");
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
