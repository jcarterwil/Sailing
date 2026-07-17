"use client";

import { useState, useTransition } from "react";
import { Reply } from "lucide-react";

import { replyToInboundEmail } from "@/app/admin/email/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function EmailReply({
  messageId,
  sender,
  subject,
  sendingConfigured,
}: {
  messageId: string;
  sender: string;
  subject: string;
  sendingConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      try {
        await replyToInboundEmail({ messageId, body });
        setBody("");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send reply.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!sendingConfigured}>
          <Reply className="size-4" aria-hidden="true" /> Reply
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reply to {sender}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`reply-${messageId}`}>Message</Label>
          <Textarea
            id={`reply-${messageId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-40"
            maxLength={20_000}
            autoFocus
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter showCloseButton>
          <Button type="button" onClick={send} disabled={pending || !body.trim()}>
            {pending ? "Sending…" : "Send reply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
