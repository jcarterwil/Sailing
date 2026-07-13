"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  LoaderCircle,
  Printer,
  RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import type { ReportSnapshot } from "@/lib/report/report-summary";

interface ReportPageClientProps {
  raceId: string;
  raceName: string;
  raceVenue: string | null;
  raceDate: string;
  isOrganizer: boolean;
  initialSnapshot: ReportSnapshot;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return "";
}

async function readSnapshot(response: Response): Promise<ReportSnapshot & { error?: string }> {
  return (await response.json()) as ReportSnapshot & { error?: string };
}

export function ReportPageClient({
  raceId,
  raceName,
  raceVenue,
  raceDate,
  isOrganizer,
  initialSnapshot,
}: ReportPageClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [requestError, setRequestError] = useState<string | null>(null);
  const isGenerating = snapshot.report?.status === "generating";

  useEffect(() => {
    if (!isGenerating) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/races/${raceId}/report`, {
          cache: "no-store",
        });
        const result = await readSnapshot(response);
        if (cancelled) return;
        if (!response.ok) {
          setRequestError(result.error ?? "Could not refresh report status.");
          return;
        }
        setSnapshot((current) => ({
          report: result.report,
          latestComplete: result.latestComplete ?? current.latestComplete,
        }));
        setRequestError(null);
      } catch {
        if (!cancelled) setRequestError("Could not refresh report status.");
      }
    };
    const timer = window.setInterval(poll, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isGenerating, raceId]);

  const generate = async () => {
    const previousSnapshot = snapshot;
    setRequestError(null);
    setSnapshot((current) => ({
      ...current,
      report: {
        id: "pending",
        status: "generating",
        markdown: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    }));
    try {
      const response = await fetch(`/api/races/${raceId}/report`, {
        method: "POST",
      });
      const result = await readSnapshot(response);
      if (result.report) {
        setSnapshot((current) => ({
          report: result.report,
          latestComplete: result.latestComplete ?? current.latestComplete,
        }));
      } else {
        setSnapshot(previousSnapshot);
      }
      if (!response.ok) {
        setRequestError(result.error ?? "Could not generate the coach report.");
      }
    } catch {
      setSnapshot(previousSnapshot);
      setRequestError("Could not start report generation.");
    }
  };

  const completeReport = snapshot.latestComplete;
  const hasPriorReport = !!completeReport?.markdown;

  return (
    <main className="report-print-page mx-auto min-h-screen w-full max-w-5xl px-5 py-8 sm:px-10 lg:px-12">
      <header className="print-hidden border-b border-border/70 pb-6">
        <Link
          href={`/races/${raceId}`}
          className="mb-4 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Manage race
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <FileText className="size-6 text-primary" aria-hidden="true" />
              Coach report
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {raceName}
              {raceVenue ? ` · ${raceVenue}` : ""} · {new Date(raceDate).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {completeReport?.markdown && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer aria-hidden="true" />
                Print / PDF
              </Button>
            )}
            {isOrganizer && (
              <Button onClick={generate} disabled={isGenerating}>
                {isGenerating ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                {hasPriorReport ? "Regenerate" : "Generate report"}
              </Button>
            )}
          </div>
        </div>
      </header>

      {(isGenerating || requestError || snapshot.report?.status === "error") && (
        <section className="print-hidden py-6" aria-live="polite">
          {isGenerating && (
            <div
              className="flex items-center gap-3 rounded-lg border border-border bg-card/70 p-4 text-sm"
              role="status"
            >
              <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
              Generating the Race Dossier. This page checks progress every 3 seconds.
            </div>
          )}
          {(requestError || snapshot.report?.errorMessage) && !isGenerating && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{requestError ?? snapshot.report?.errorMessage}</span>
            </div>
          )}
        </section>
      )}

      {completeReport?.markdown ? (
        <article className="report-document py-8">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1>{children}</h1>,
              h2: ({ children }) => (
                <h2 className={nodeText(children).startsWith("Part 2") ? "report-part-two" : undefined}>
                  {children}
                </h2>
              ),
              h3: ({ children }) => <h3>{children}</h3>,
              table: ({ children }) => (
                <div className="report-table-wrap">
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {completeReport.markdown}
          </ReactMarkdown>
          <footer className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
            Generated {new Date(completeReport.completedAt ?? completeReport.createdAt).toLocaleString()}
            {completeReport.model ? ` · ${completeReport.model}` : ""}
          </footer>
        </article>
      ) : (
        !isGenerating && (
          <section className="py-20 text-center">
            <FileText className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold">No coach report yet</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              {isOrganizer
                ? "Analyze the completed race, then generate its first Race Dossier."
                : "The race organizer has not generated a Race Dossier yet."}
            </p>
          </section>
        )
      )}
    </main>
  );
}
