"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";

import {
  sendBroadcast,
  type BroadcastAudience,
} from "@/app/admin/email/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface AudienceOption {
  id: string;
  label: string;
}

export function EmailComposer({
  boats,
  members,
  sendingConfigured,
}: {
  boats: AudienceOption[];
  members: AudienceOption[];
  sendingConfigured: boolean;
}) {
  const [audience, setAudience] = useState<BroadcastAudience>("all_members");
  const [boatId, setBoatId] = useState(boats[0]?.id ?? "");
  const [userId, setUserId] = useState(members[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    if (
      audience === "all_members" &&
      !window.confirm("Send this message to every eligible member?")
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await sendBroadcast({
          audience,
          boatId: audience === "boat_members" ? boatId : null,
          userId: audience === "individual" ? userId : null,
          subject,
          body,
          ctaLabel,
          ctaUrl,
        });
        setNotice(
          `${result.sentCount} sent, ${result.skippedCount} skipped by preference or missing address, ${result.failedCount} failed.`,
        );
        setSubject("");
        setBody("");
        setCtaLabel("");
        setCtaUrl("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send email.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email-audience">Audience</Label>
          <Select
            value={audience}
            onValueChange={(value) => setAudience(value as BroadcastAudience)}
          >
            <SelectTrigger id="email-audience" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_members">All members</SelectItem>
              <SelectItem value="boat_members">Boat owner and crew</SelectItem>
              <SelectItem value="individual">One member</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {audience === "boat_members" ? (
          <div className="space-y-2">
            <Label htmlFor="email-boat">Boat</Label>
            <Select value={boatId} onValueChange={setBoatId}>
              <SelectTrigger id="email-boat" className="w-full">
                <SelectValue placeholder="Choose a boat" />
              </SelectTrigger>
              <SelectContent>
                {boats.map((boat) => (
                  <SelectItem key={boat.id} value={boat.id}>
                    {boat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {audience === "individual" ? (
          <div className="space-y-2">
            <Label htmlFor="email-member">Member</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="email-member" className="w-full">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={200}
          placeholder="What members need to know"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email-body">Message</Label>
        <Textarea
          id="email-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={20_000}
          className="min-h-40"
          placeholder="Write the member update…"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email-cta-label">Button label (optional)</Label>
          <Input
            id="email-cta-label"
            value={ctaLabel}
            onChange={(event) => setCtaLabel(event.target.value)}
            maxLength={80}
            placeholder="View details"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email-cta-url">Button destination (optional)</Label>
          <Input
            id="email-cta-url"
            value={ctaUrl}
            onChange={(event) => setCtaUrl(event.target.value)}
            maxLength={2_000}
            placeholder="/boats/… or https://…"
          />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not send</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Broadcast complete</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {!sendingConfigured ? (
        <Alert variant="destructive">
          <AlertTitle>Sending is not configured</AlertTitle>
          <AlertDescription>Add RESEND_API_KEY and RESEND_FROM_EMAIL before sending.</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        onClick={send}
        disabled={
          pending ||
          !sendingConfigured ||
          !subject.trim() ||
          !body.trim() ||
          (audience === "boat_members" && !boatId) ||
          (audience === "individual" && !userId)
        }
      >
        <Send className="size-4" aria-hidden="true" />
        {pending ? "Sending…" : "Send email"}
      </Button>
    </div>
  );
}
