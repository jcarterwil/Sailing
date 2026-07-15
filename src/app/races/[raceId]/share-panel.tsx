"use client";

import { useState, useTransition } from "react";
import { Copy, Link2 } from "lucide-react";

import { toggleShare } from "@/app/races/actions";
import { HelpTip } from "@/components/help/help-tip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 font-mono text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy className="size-3.5" aria-hidden="true" />
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function SharePanel({
  raceId,
  initialSlug,
}: {
  raceId: string;
  initialSlug: string | null;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const enabled = !!slug;
  const origin = siteOrigin();
  const shareUrl = slug && origin ? `${origin}/s/${slug}` : null;

  function onToggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleShare(raceId, next);
        setSlug(result.shareSlug);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update sharing.");
      }
    });
  }

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4 text-primary" aria-hidden="true" />
          Public share link
          <HelpTip termKey="publicShare" />
        </CardTitle>
        <CardDescription>
          Anyone with the link can open the replay and coach report without signing in.
          Turning sharing off immediately invalidates the URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="share-toggle" className="text-sm font-medium">
            Enable public link
          </Label>
          <Switch
            id="share-toggle"
            checked={enabled}
            disabled={pending}
            onCheckedChange={onToggle}
          />
        </div>
        {shareUrl && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
              {shareUrl}
            </code>
            <CopyUrlButton url={shareUrl} />
          </div>
        )}
        {enabled && !origin && (
          <p className="text-xs text-muted-foreground">
            Set <code className="font-mono">NEXT_PUBLIC_SITE_URL</code> to show the
            full share URL.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
