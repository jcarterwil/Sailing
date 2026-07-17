"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";

import { updateAiModel } from "@/app/admin/ai/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiModelOption } from "@/lib/ai/settings";
import type { AiProvider } from "@/lib/ai/contracts";

export function AiSettingsForm({
  initialModel,
  provider,
  models,
  discoveryWarning,
}: {
  initialModel: string;
  provider: AiProvider;
  models: AiModelOption[];
  discoveryWarning: string | null;
}) {
  const [model, setModel] = useState(initialModel);
  const [savedModel, setSavedModel] = useState(initialModel);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await updateAiModel(model);
        setSavedModel(model.trim());
        setNotice(result.warning ?? "AI model saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save AI model.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="ai-model">{provider === "vercel" ? "Vercel AI Gateway" : "Anthropic"} model</Label>
        <Input
          id="ai-model"
          list="anthropic-models"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="claude-sonnet-4-6"
          spellCheck={false}
          autoComplete="off"
        />
        <datalist id="anthropic-models">
          {models.map((option) => (
            <option key={option.id} value={option.id}>
              {option.displayName}
            </option>
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          This is the global model used by today&apos;s AI functions. Provider routing and API
          credentials remain server-side; credentials are never stored here.
        </p>
      </div>

      {models.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="text-xs font-medium">Models available to this API key</p>
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {models.slice(0, 12).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="text-left hover:text-foreground"
                  onClick={() => setModel(option.id)}
                >
                  {option.displayName} · <code>{option.id}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {discoveryWarning && (
        <Alert>
          <AlertTitle>Live model list unavailable</AlertTitle>
          <AlertDescription>{discoveryWarning}</AlertDescription>
        </Alert>
      )}
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

      <Button type="button" onClick={save} disabled={pending || model.trim() === savedModel}>
        <Save className="size-4" aria-hidden="true" />
        {pending ? "Saving…" : "Save model"}
      </Button>
    </div>
  );
}
