"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";

import { updateNotificationPreferences } from "@/app/account/notifications/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface EditableNotificationPreferences {
  emailEnabled: boolean;
  adminAnnouncements: boolean;
  boatActivity: boolean;
  reportReady: boolean;
}

export function NotificationPreferencesForm({
  initial,
  suppressedReason,
}: {
  initial: EditableNotificationPreferences;
  suppressedReason: string | null;
}) {
  const [preferences, setPreferences] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = JSON.stringify(preferences) !== JSON.stringify(saved);

  function set<Key extends keyof EditableNotificationPreferences>(
    key: Key,
    value: EditableNotificationPreferences[Key],
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await updateNotificationPreferences(preferences);
        setSaved(preferences);
        setNotice("Email preferences saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save preferences.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {suppressedReason ? (
        <Alert variant="destructive">
          <AlertTitle>Email delivery is provider-suppressed</AlertTitle>
          <AlertDescription>
            Resend reported {suppressedReason.replace("email.", "")}. Your choices are saved, but
            application messages remain paused until an administrator resolves the suppression.
          </AlertDescription>
        </Alert>
      ) : null}

      <PreferenceRow
        id="email-enabled"
        title="Application email"
        description="Master switch for announcements and sailing updates. Sign-in and security email is not affected."
        checked={preferences.emailEnabled}
        onCheckedChange={(checked) => set("emailEnabled", checked)}
      />
      <div className="space-y-1 rounded-lg border border-border/70">
        <PreferenceRow
          id="admin-announcements"
          title="Member announcements"
          description="Operational notices and updates sent by an administrator."
          checked={preferences.adminAnnouncements}
          onCheckedChange={(checked) => set("adminAnnouncements", checked)}
          disabled={!preferences.emailEnabled}
          nested
        />
        <PreferenceRow
          id="boat-activity"
          title="Boat activity"
          description="Track data and other information becoming available for boats you own or crew."
          checked={preferences.boatActivity}
          onCheckedChange={(checked) => set("boatActivity", checked)}
          disabled={!preferences.emailEnabled}
          nested
        />
        <PreferenceRow
          id="report-ready"
          title="Coach reports"
          description="A coach report has finished generating for a race you participate in."
          checked={preferences.reportReady}
          onCheckedChange={(checked) => set("reportReady", checked)}
          disabled={!preferences.emailEnabled}
          nested
          last
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Preferences updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="button" onClick={save} disabled={pending || !changed}>
        <Save className="size-4" aria-hidden="true" />
        {pending ? "Saving…" : "Save preferences"}
      </Button>
    </div>
  );
}

function PreferenceRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  nested = false,
  last = false,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  nested?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={
        nested
          ? `flex items-start justify-between gap-6 p-4 ${last ? "" : "border-b border-border/70"}`
          : "flex items-start justify-between gap-6 rounded-lg border border-border/70 p-4"
      }
    >
      <div className={disabled ? "opacity-60" : undefined}>
        <Label htmlFor={id}>{title}</Label>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}
