import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot } from "lucide-react";

import { AiSettingsForm } from "@/app/admin/ai/ai-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_AI_MODEL, listAvailableAiModels } from "@/lib/ai/settings";
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
    supabase.from("ai_settings").select("model").eq("id", true).maybeSingle(),
    listAvailableAiModels(),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-8 sm:px-10 lg:px-12">
      <header className="border-b border-border/70 pb-6">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          Back to dashboard
        </Link>
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <Bot className="size-6 text-primary" aria-hidden="true" />
          AI settings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Control the model used by server-side AI features without changing a deployment.
        </p>
      </header>

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
    </main>
  );
}
