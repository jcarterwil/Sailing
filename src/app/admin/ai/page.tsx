import { redirect } from "next/navigation";

import { AiSettingsForm } from "@/app/admin/ai/ai-settings-form";
import { ReportAiSettingsForm } from "@/app/admin/ai/report-ai-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AI_FUNCTIONS, type AiFunctionRoute } from "@/lib/ai/contracts";
import {
  DEFAULT_AI_FUNCTION_ROUTES,
  listAvailableAiModelsByProvider,
} from "@/lib/ai/settings";
import {
  DEFAULT_DOSSIER_THINKING,
  DOSSIER_SYSTEM_PROMPT,
} from "@/lib/report/dossier-request";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · AI",
};

export default async function AdminAiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) redirect("/dashboard");

  const [settingsResult, routingResult, catalogs] = await Promise.all([
    supabase
      .from("ai_settings")
      .select("report_system_prompt, report_thinking, report_effort")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("ai_function_routes")
      .select("function, provider, model, max_output_tokens")
      .order("function"),
    listAvailableAiModelsByProvider(),
  ]);
  if (settingsResult.error) {
    throw new Error(`Could not load AI request settings: ${settingsResult.error.message}`);
  }
  if (routingResult.error) {
    throw new Error(`Could not load AI function routes: ${routingResult.error.message}`);
  }
  const settings = settingsResult.data;
  const routingRows = routingResult.data;

  const routes: AiFunctionRoute[] = AI_FUNCTIONS.map((aiFunction) => {
    const row = routingRows?.find((candidate) => candidate.function === aiFunction);
    if (!row) return DEFAULT_AI_FUNCTION_ROUTES[aiFunction];
    return {
      function: aiFunction,
      provider: row.provider === "vercel" ? "vercel" : "anthropic",
      model: row.model,
      maxOutputTokens: row.max_output_tokens,
    };
  });

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="AI settings"
        description="Route each server-side AI function independently and cap its output budget."
      />

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Model routing</CardTitle>
            <CardDescription>
              Keep direct Anthropic where needed, or choose any compatible model from Vercel AI
              Gateway&apos;s live multi-provider catalog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AiSettingsForm routes={routes} catalogs={catalogs} />
          </CardContent>
        </Card>
      </section>

      <section className="pb-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Coach report</CardTitle>
            <CardDescription>
              Tune the Race Dossier request — system prompt, output budget, thinking, and effort —
              without a redeploy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReportAiSettingsForm
              initialSystemPrompt={settings?.report_system_prompt ?? ""}
              defaultSystemPrompt={DOSSIER_SYSTEM_PROMPT}
              initialThinking={
                settings?.report_thinking === "adaptive" ? "adaptive" : DEFAULT_DOSSIER_THINKING
              }
              initialEffort={settings?.report_effort ?? ""}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
