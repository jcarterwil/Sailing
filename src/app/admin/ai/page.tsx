import { redirect } from "next/navigation";

import { AiSettingsForm } from "@/app/admin/ai/ai-settings-form";
import { ReportAiSettingsForm } from "@/app/admin/ai/report-ai-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_AI_MODEL, listAvailableAiModels } from "@/lib/ai/settings";
import {
  DEFAULT_DOSSIER_MAX_TOKENS,
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

  const [{ data: settings }, available] = await Promise.all([
    supabase
      .from("ai_settings")
      .select("model, report_system_prompt, report_max_tokens, report_thinking, report_effort")
      .eq("id", true)
      .maybeSingle(),
    listAvailableAiModels(),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="AI settings"
        description="Control the model used by server-side AI features without changing a deployment."
      />

      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Model routing</CardTitle>
            <CardDescription>
              Anthropic is the configured provider. The selected model is validated against the
              live Models API when a server key is available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AiSettingsForm
              initialModel={settings?.model ?? DEFAULT_AI_MODEL}
              models={available.models}
              discoveryWarning={available.warning}
            />
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
              initialMaxTokens={settings?.report_max_tokens ?? DEFAULT_DOSSIER_MAX_TOKENS}
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
