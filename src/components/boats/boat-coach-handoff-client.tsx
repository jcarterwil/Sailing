"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sessionWorkspaceHref } from "@/components/sessions/session-workspace-nav";
import type { CitedPerformanceHistoryHandoffV1 } from "@/lib/boats/performance-history/types";
import Link from "next/link";

/** Optional Coach handoff UI — copies cited summaries or requests coach notes. */
export function BoatCoachHandoffClient({
  handoff,
  coachPath,
  canGenerate = false,
}: {
  handoff: CitedPerformanceHistoryHandoffV1;
  coachPath: string;
  /** POST generation burns Anthropic tokens — owners/editors only. */
  canGenerate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function copyHandoff() {
    startTransition(async () => {
      setError(null);
      try {
        await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        setError("Could not copy the cited handoff package.");
      }
    });
  }

  function requestCoachNotes() {
    startTransition(async () => {
      setError(null);
      setMarkdown(null);
      try {
        const response = await fetch(coachPath, {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const body = (await response.json()) as {
          error?: string;
          markdown?: string;
        };
        if (!response.ok) {
          setError(body.error ?? "Coach generation failed.");
          return;
        }
        setMarkdown(body.markdown ?? null);
      } catch {
        setError("Coach generation request failed.");
      }
    });
  }

  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Cited Coach handoff</CardTitle>
        <CardDescription>
          Optional. Coach receives only these compact cited summaries — every
          claim links back to included observations/Sessions. Association/trend
          language only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">n={handoff.n}</Badge>
          <Badge variant="outline">{handoff.aggregatesStatus}</Badge>
          <Badge variant="secondary">{handoff.languagePolicy}</Badge>
        </div>

        <ul className="space-y-3 text-sm">
          {handoff.claims.map((claim) => (
            <li key={claim.id} className="rounded-md border border-border/60 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{claim.kind}</Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {claim.id}
                </span>
              </div>
              <p>{claim.text}</p>
              {claim.citationSessionIds.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Citations:{" "}
                  {claim.citationSessionIds.slice(0, 6).map((sessionId, index) => (
                    <span key={sessionId}>
                      {index > 0 ? ", " : null}
                      <Link
                        href={sessionWorkspaceHref(sessionId, "performance")}
                        className="text-primary hover:underline"
                      >
                        {sessionId.slice(0, 8)}
                      </Link>
                    </span>
                  ))}
                  {claim.citationSessionIds.length > 6
                    ? ` +${claim.citationSessionIds.length - 6} more`
                    : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={copyHandoff}
          >
            {copied ? "Copied cited JSON" : "Copy cited handoff"}
          </Button>
          {canGenerate ? (
            <Button
              type="button"
              className="min-h-11"
              disabled={pending || handoff.n === 0}
              onClick={requestCoachNotes}
            >
              {pending ? "Working…" : "Generate Coach notes"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Owner/editor access is required to generate Coach notes.
            </p>
          )}
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {markdown ? (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap text-sm">{markdown}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
