"use client";

import { Copy, ExternalLink, Link2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { toggleSeriesShare } from "@/app/series/actions";
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

function configuredOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

function CopySeriesUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 font-mono text-xs"
      onClick={async () => {
        const clipboardUrl = new URL(url, window.location.origin).toString();
        await navigator.clipboard.writeText(clipboardUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    >
      <Copy className="size-3.5" aria-hidden="true" />
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function SeriesSharePanel({
  seriesId,
  revision,
  initialSlug,
  onRevisionChange,
}: {
  seriesId: string;
  revision: number;
  initialSlug: string | null;
  onRevisionChange: (revision: number) => void;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const enabled = Boolean(slug);
  const publicPath = slug ? `/series/s/${slug}` : null;
  const origin = configuredOrigin();
  const displayedUrl = publicPath && origin ? `${origin}${publicPath}` : publicPath;

  function onToggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleSeriesShare({
          seriesId,
          expectedRevision: revision,
          enable: next,
        });
        setSlug(result.shareSlug);
        onRevisionChange(result.revision);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not update sharing.");
      }
    });
  }

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4 text-primary" aria-hidden="true" />
          Public series report
        </CardTitle>
        <CardDescription>
          Anyone with the capability link can view the latest validated standings. Turning it off
          immediately invalidates the URL; races remain unlinked unless their own sharing is active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="series-share-toggle" className="text-sm font-medium">
            Enable public link
          </Label>
          <Switch
            id="series-share-toggle"
            checked={enabled}
            disabled={pending}
            onCheckedChange={onToggle}
          />
        </div>
        {publicPath && displayedUrl ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
              {displayedUrl}
            </code>
            <div className="flex gap-2">
              <CopySeriesUrlButton url={displayedUrl} />
              <Button asChild variant="outline" size="sm">
                <Link href={publicPath} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
        {pending ? <p className="text-xs text-muted-foreground" role="status">Updating public access…</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
