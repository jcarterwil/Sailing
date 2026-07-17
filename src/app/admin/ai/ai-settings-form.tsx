"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";

import { updateAiFunctionRoute } from "@/app/admin/ai/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiFunction, AiFunctionRoute, AiProvider } from "@/lib/ai/contracts";
import type { AiModelOption } from "@/lib/ai/settings";

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

const FUNCTION_LABELS: Record<AiFunction, { title: string; description: string }> = {
  dossier: {
    title: "Race Dossier",
    description: "Long-form race analysis and per-boat conclusions.",
  },
  performance_coach: {
    title: "Performance History coach",
    description: "Cited cross-session coaching notes for one boat.",
  },
  wind_explanation: {
    title: "Wind-quality explanations",
    description: "Short structured explanations of sensor-quality findings.",
  },
  weather_interpretation: {
    title: "Weather interpretation",
    description: "Structured race-condition notes from weather-service evidence.",
  },
};

type Catalog = { models: AiModelOption[]; warning: string | null };

function FunctionRouteEditor({
  initialRoute,
  catalogs,
}: {
  initialRoute: AiFunctionRoute;
  catalogs: Record<AiProvider, Catalog>;
}) {
  const [provider, setProvider] = useState<AiProvider>(initialRoute.provider);
  const [model, setModel] = useState(initialRoute.model);
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(initialRoute.maxOutputTokens));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const catalog = catalogs[provider];
  const labels = FUNCTION_LABELS[initialRoute.function];
  const listId = `${initialRoute.function}-${provider}-models`;

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await updateAiFunctionRoute({
          function: initialRoute.function,
          provider,
          model,
          maxOutputTokens: Number(maxOutputTokens),
        });
        setNotice(result.warning ?? "Route saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save AI route.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-semibold">{labels.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{labels.description}</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)_9rem]">
        <div className="space-y-2">
          <Label htmlFor={`${initialRoute.function}-provider`}>Gateway</Label>
          <select
            id={`${initialRoute.function}-provider`}
            className={SELECT_CLASS}
            value={provider}
            onChange={(event) => setProvider(event.target.value === "vercel" ? "vercel" : "anthropic")}
          >
            <option value="anthropic">Direct Anthropic</option>
            <option value="vercel">Vercel AI Gateway</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${initialRoute.function}-model`}>Model</Label>
          <Input
            id={`${initialRoute.function}-model`}
            list={listId}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={provider === "vercel" ? "anthropic/claude-sonnet-4.6" : "claude-sonnet-4-6"}
            spellCheck={false}
            autoComplete="off"
          />
          <datalist id={listId}>
            {catalog.models.map((option) => (
              <option key={option.id} value={option.id}>{option.displayName}</option>
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${initialRoute.function}-tokens`}>Output cap</Label>
          <Input
            id={`${initialRoute.function}-tokens`}
            type="number"
            min={100}
            max={21000}
            step={50}
            value={maxOutputTokens}
            onChange={(event) => setMaxOutputTokens(event.target.value)}
          />
        </div>
      </div>

      {catalog.warning && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{catalog.warning}</p>
      )}
      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="mt-4">
          <AlertTitle>Settings updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Button type="button" size="sm" className="mt-4" onClick={save} disabled={pending}>
        <Save className="size-4" aria-hidden="true" />
        {pending ? "Saving…" : `Save ${labels.title}`}
      </Button>
    </div>
  );
}

export function AiSettingsForm({
  routes,
  catalogs,
}: {
  routes: AiFunctionRoute[];
  catalogs: Record<AiProvider, Catalog>;
}) {
  return (
    <div className="space-y-4">
      {routes.map((route) => (
        <FunctionRouteEditor key={route.function} initialRoute={route} catalogs={catalogs} />
      ))}
      <p className="text-xs text-muted-foreground">
        Output caps are hard per-call limits. Credentials stay server-side and are never stored in
        the database. Vercel deployments authenticate to AI Gateway with OIDC.
      </p>
    </div>
  );
}
