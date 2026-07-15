"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRightLeft,
  Copy,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
} from "lucide-react";

import {
  clearClaim,
  createBoat,
  inviteBoatOwner,
  regenerateClaimCode,
  startOwnershipTransfer,
  updateBoat,
} from "@/app/admin/actions";
import { MergeDuplicateDialog } from "@/app/admin/boats/merge-duplicate-dialog";
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
import { getOwnerInvitationUrl } from "@/lib/boats/owner-invitations";

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
  mergedIntoId: string | null;
  mergedAt: string | null;
  mergeTargetName: string | null;
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

function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function showCopied() {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return { copied, showCopied };
}

function CopyButton({
  value,
  label,
  displayValue = value,
  monospace = true,
}: {
  value: string;
  label: string;
  displayValue?: string;
  monospace?: boolean;
}) {
  const { copied, showCopied } = useCopyFeedback();
  if (!value) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`gap-1 ${monospace ? "font-mono" : ""}`}
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        showCopied();
      }}
    >
      <Copy className="size-3.5" aria-hidden="true" />
      {copied ? "Copied" : displayValue}
    </Button>
  );
}

function CopyInvitationLinkButton({ code }: { code: string }) {
  const { copied, showCopied } = useCopyFeedback();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={async () => {
        await navigator.clipboard.writeText(getOwnerInvitationUrl(window.location.origin, code));
        showCopied();
      }}
    >
      <Link2 className="size-3.5" aria-hidden="true" />
      {copied ? "Copied" : "Copy owner link"}
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
            Create a pending owner invitation. The recipient becomes owner only after opening the
            link, signing in, and accepting.
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
                Emails the same owner link that you can copy after creation.
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
  includeClaimEmail = true,
}: {
  form: BoatForm;
  onChange: (form: BoatForm) => void;
  includeClaimEmail?: boolean;
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
      {includeClaimEmail && (
        <div className="space-y-2">
          <Label htmlFor="claim-email">Owner email (optional)</Label>
          <Input
            id="claim-email"
            type="email"
            value={form.claimEmail}
            onChange={(e) => onChange({ ...form, claimEmail: e.target.value })}
            placeholder="racer@example.com"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to invite the owner by copied link only.
          </p>
        </div>
      )}
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

  // inviteBoatOwner reads the saved claim_email, so require Save first when the
  // field is dirty — otherwise the invite could go to the wrong address.
  const emailDirty =
    form.claimEmail.trim().toLowerCase() !== (row.claimEmail ?? "").toLowerCase();

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
        setNotice(
          res.recipient === "existing"
            ? "Sign-in link sent. Ownership is still pending acceptance."
            : "Account invitation sent. Ownership is still pending acceptance.",
        );
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
                Pending owner invitation: <code className="font-mono">{row.claimCode}</code>
              </>
            ) : (
              "No pending owner invitation."
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
          <BoatFormFields form={form} onChange={setForm} includeClaimEmail={!row.ownerId} />
          {emailDirty && form.claimEmail.trim() && (
            <p className="text-xs text-muted-foreground">
              Save the new email before sending an invite.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          <DialogFooter className="flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={regenerate}
              disabled={pending || (!!row.ownerId && !row.claimCode)}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Regenerate link
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={invite}
              disabled={pending || !row.claimEmail || emailDirty}
              title={emailDirty ? "Save the new email first" : undefined}
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
              Revoke invite
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

function TransferOwnerDialog({ row }: { row: BoatRow }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(row.claimEmail ?? "");
  const [sendInvite, setSendInvite] = useState(Boolean(row.claimEmail));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail(row.claimEmail ?? "");
    setSendInvite(Boolean(row.claimEmail));
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startOwnershipTransfer(row.id, { email, sendInvite });
        if (result.emailError) {
          setError(
            `The owner link was created, but email failed: ${result.emailError} Copy the link from the boat row instead.`,
          );
          return;
        }
        setOpen(false);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
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
        <Button variant="ghost" size="sm">
          <ArrowRightLeft className="size-3.5" aria-hidden="true" />
          {row.claimCode ? "Change transfer" : "Transfer owner"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership of {row.name}</DialogTitle>
          <DialogDescription>
            {row.ownerName ?? "The current owner"} keeps ownership until someone opens the new link
            and explicitly accepts. Creating a new link revokes any previous one.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`transfer-email-${row.id}`}>New owner email (optional)</Label>
            <Input
              id={`transfer-email-${row.id}`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                const nextEmail = event.target.value;
                setEmail(nextEmail);
                if (!nextEmail.trim()) setSendInvite(false);
              }}
              placeholder="new-owner@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to share the owner link yourself.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
            <div className="space-y-0.5">
              <Label htmlFor={`transfer-send-${row.id}`}>Send invite email</Label>
              <p className="text-xs text-muted-foreground">The link also works for existing users.</p>
            </div>
            <Switch
              id={`transfer-send-${row.id}`}
              checked={sendInvite}
              onCheckedChange={setSendInvite}
              disabled={!email.trim()}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create transfer link"}
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
          {row.mergedIntoId ? (
            <Badge variant="secondary">
              Merged into {row.mergeTargetName ?? "canonical boat"}
            </Badge>
          ) : row.ownerId ? (
            <Badge variant="secondary" className="gap-1">
              <UserCheck className="size-3" aria-hidden="true" />
              Owner: {row.ownerName ?? "claimed"}
            </Badge>
          ) : !row.claimCode ? (
            <Badge variant="outline">unclaimed</Badge>
          ) : null}
          {!row.mergedIntoId && row.claimCode && (
            <Badge variant="outline">
              {row.ownerId ? "transfer pending" : "owner invite pending"}
            </Badge>
          )}
          {!row.mergedIntoId && row.claimEmail && (
            <span className="text-xs text-muted-foreground">{row.claimEmail}</span>
          )}
          {!row.mergedIntoId && row.claimCode && (
            <>
              <CopyInvitationLinkButton code={row.claimCode} />
              <CopyButton value={row.claimCode} label="Copy owner invitation code" />
            </>
          )}
          {row.mergedIntoId ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/boats/${row.mergedIntoId}`}>Open canonical</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/boats/${row.id}/crew`}>Crew access</Link>
              </Button>
              {row.ownerId && <TransferOwnerDialog row={row} />}
              <MergeDuplicateDialog source={row} candidates={rows} />
              <EditBoatDialog row={row} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
