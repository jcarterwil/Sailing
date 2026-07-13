"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Save } from "lucide-react";

import { updateReportAiSettings } from "@/app/admin/ai/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

export function ReportAiSettingsForm({
  initialSystemPrompt,
  defaultSystemPrompt,
  initialMaxTokens,
  initialThinking,
  initialEffort,
}: {
  initialSystemPrompt: string;
  defaultSystemPrompt: string;
  initialMaxTokens: number;
  initialThinking: "off" | "adaptive";
  initialEffort: string;
}) {
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt);
  const [maxTokens, setMaxTokens] = useState(String(initialMaxTokens));
  const [thinking, setThinking] = useState<"off" | "adaptive">(initialThinking);
  const [effort, setEffort] = useState(initialEffort);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await updateReportAiSettings({
          systemPrompt,
          maxTokens: Number(maxTokens),
          thinking,
          effort: thinking === "adaptive" ? effort : "",
        });
        setNotice("Coach-report settings saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save coach-report settings.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="report-system-prompt">System prompt</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSystemPrompt(defaultSystemPrompt)}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Load default
          </Button>
        </div>
        <Textarea
          id="report-system-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="Leave blank to use the built-in Race Dossier prompt."
          rows={10}
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Instructions for the Race Dossier. Leave blank to use the built-in default. The dossier
          must still produce its required Markdown sections.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="report-max-tokens">Max output tokens</Label>
          <Input
            id="report-max-tokens"
            type="number"
            min={1024}
            max={21000}
            step={1000}
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="report-thinking">Thinking</Label>
          <select
            id="report-thinking"
            className={SELECT_CLASS}
            value={thinking}
            onChange={(event) => setThinking(event.target.value === "adaptive" ? "adaptive" : "off")}
          >
            <option value="off">Off</option>
            <option value="adaptive">Adaptive</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="report-effort">Effort</Label>
          <select
            id="report-effort"
            className={SELECT_CLASS}
            value={effort}
            disabled={thinking !== "adaptive"}
            onChange={(event) => setEffort(event.target.value)}
          >
            <option value="">Default</option>
            {EFFORTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Newer Claude models run adaptive thinking by default, which can exhaust the output budget
        before the dossier finishes. Keep Thinking = Off unless you also raise Max output tokens.
        Effort applies only when Thinking is Adaptive.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertTitle>Settings updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Button type="button" onClick={save} disabled={pending}>
        <Save className="size-4" aria-hidden="true" />
        {pending ? "Saving…" : "Save coach report settings"}
      </Button>
    </div>
  );
}
