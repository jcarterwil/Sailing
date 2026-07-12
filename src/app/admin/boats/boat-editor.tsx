"use client";

import { useState, useTransition } from "react";
import { Copy, Mail, Plus, RefreshCw, Trash2, UserCheck } from "lucide-react";

import {
  clearClaim,
  createBoat,
  inviteBoatOwner,
  regenerateClaimCode,
  updateBoat,
} from "@/app/admin/actions";
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
import { Switch } from "@/components/ui/switch";

export interface BoatRow {
  id: string;
  name: string;
  sailNumber: string | null;
  boatClass: string | null;
  claimEmail: string | null;
  claimCode: string | null;
  ownerId: string | null;
  ownerName: string | null;
  creatorName: string | null;
}

interface BoatForm {
  name: string;
  sailNumber: string;
  boatClass: string;
  claimEmail: string;
}

const EMPTY_FORM: BoatForm = {
  name: "",
  sailNumber: "",
  boatClass: "",
  claimEmail: "",
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1 font-mono"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy className="size-3.5" aria-hidden="true" />
      {copied ? "Copied" : value}
    </Button>
  );
}

export function CreateBoatButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BoatForm>(EMPTY_FORM);
  const [sendInvite, setSendInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setForm(EMPTY_FORM);
    setSendInvite(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await createBoat({
          name: form.name,
          sailNumber: form.sailNumber || null,
          boatClass: form.boatClass || null,
          claimEmail: form.claimEmail || null,
          sendInvite,
        });
        reset();
        setOpen(false);
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          Add boat
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a boat</DialogTitle>
          <DialogDescription>
            Pre-register a boat for a racer. They can claim it by signing up with the matching
            email, or by entering the generated code at /claim.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <BoatFormFields form={form} onChange={setForm} />
          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
            <div className="space-y-0.5">
              <Label htmlFor="send-invite">Send invite email</Label>
              <p className="text-xs text-muted-foreground">
                Creates the racer&apos;s account now and emails a sign-in link.
              </p>
            </div>
            <Switch
              id="send-invite"
              checked={sendInvite}
              onCheckedChange={setSendInvite}
              disabled={!form.claimEmail.trim()}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create boat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BoatFormFields({
  form,
  onChange,
}: {
  form: BoatForm;
  onChange: (form: BoatForm) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="boat-name">Boat name</Label>
        <Input
          id="boat-name"
          required
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="Rock Steady"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sail-number">Sail number</Label>
          <Input
            id="sail-number"
            value={form.sailNumber}
            onChange={(e) => onChange({ ...form, sailNumber: e.target.value })}
            placeholder="US 12345"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="boat-class">Class</Label>
          <Input
            id="boat-class"
            value={form.boatClass}
            onChange={(e) => onChange({ ...form, boatClass: e.target.value })}
            placeholder="J/105"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="claim-email">Claim email</Label>
        <Input
          id="claim-email"
          type="email"
          value={form.claimEmail}
          onChange={(e) => onChange({ ...form, claimEmail: e.target.value })}
          placeholder="racer@example.com"
        />
      </div>
    </>
  );
}

function EditBoatDialog({ row }: { row: BoatRow }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BoatForm>({
    name: row.name,
    sailNumber: row.sailNumber ?? "",
    boatClass: row.boatClass ?? "",
    claimEmail: row.claimEmail ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setError(null);
    setNotice(null);
  }

  function submit() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await updateBoat(row.id, {
          name: form.name,
          sailNumber: form.sailNumber || null,
          boatClass: form.boatClass || null,
          claimEmail: form.claimEmail || null,
        });
        setOpen(false);
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          setError(err.message);
        }
      }
    });
  }

  function regenerate() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await regenerateClaimCode(row.id);
        if (res?.claimCode) {
          setNotice(`New code: ${res.claimCode}`);
        }
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function clear() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await clearClaim(row.id);
        setOpen(false);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function invite() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await inviteBoatOwner(row.id);
        if (res?.alreadyClaimed) setNotice("Boat already claimed.");
        else if (res?.alreadyRegistered)
          setNotice("User already registered — boat will be claimed on their next login.");
        else setNotice("Invite sent.");
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit boat</DialogTitle>
          <DialogDescription>
            {row.claimCode ? (
              <>
                Claim code: <code className="font-mono">{row.claimCode}</code>
              </>
            ) : (
              "No claim code set."
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <BoatFormFields form={form} onChange={setForm} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={regenerate}
              disabled={pending || !!row.ownerId}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Regenerate code
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={invite}
              disabled={pending || !form.claimEmail.trim() || !!row.ownerId}
            >
              <Mail className="size-3.5" aria-hidden="true" />
              Send invite
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={clear}
              disabled={pending || (!row.claimEmail && !row.claimCode)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Clear claim
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BoatsList({ rows }: { rows: BoatRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No boats yet. Add one to pre-register it for a racer.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
          {row.sailNumber && (
            <span className="text-xs text-muted-foreground">#{row.sailNumber}</span>
          )}
          {row.boatClass && <Badge variant="outline">{row.boatClass}</Badge>}
          {row.ownerId ? (
            <Badge variant="secondary" className="gap-1">
              <UserCheck className="size-3" aria-hidden="true" />
              {row.ownerName ?? "claimed"}
            </Badge>
          ) : row.claimEmail ? (
            <span className="text-xs text-muted-foreground">{row.claimEmail}</span>
          ) : (
            <Badge variant="outline">unclaimed</Badge>
          )}
          {row.claimCode && !row.ownerId && <CopyButton value={row.claimCode} label="Copy claim code" />}
          <EditBoatDialog row={row} />
        </li>
      ))}
    </ul>
  );
}
