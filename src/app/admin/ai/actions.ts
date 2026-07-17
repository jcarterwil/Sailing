"use server";

import { revalidatePath } from "next/cache";

import type { AiProvider } from "@/lib/ai/contracts";
import { validateAiModel } from "@/lib/ai/gateway";
import { createClient } from "@/lib/supabase/server";

export async function updateAiModel(modelInput: string): Promise<{ warning: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) throw new Error("Admin only.");

  const model = modelInput.trim();
  if (!model || model.length > 160 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    throw new Error("Enter a valid AI model ID.");
  }

  const { data: current, error: settingsError } = await supabase
    .from("ai_settings")
    .select("provider")
    .eq("id", true)
    .maybeSingle();
  if (settingsError) throw new Error(`Could not read AI routing: ${settingsError.message}`);
  const provider: AiProvider = current?.provider === "vercel" ? "vercel" : "anthropic";

  let warning: string | null = null;
  const keyName = provider === "vercel" ? "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN" : "ANTHROPIC_API_KEY";
  const apiKey =
    provider === "vercel"
      ? process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN
      : process.env.ANTHROPIC_API_KEY;
  if (provider === "vercel" || apiKey) {
    try {
      const selected = await validateAiModel(provider, model);
      if (selected.structuredOutputs === false) {
        throw new Error("This model does not support structured outputs required by the weather wizard.");
      }
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `${provider} did not accept that model: ${error.message}`
          : `${provider} did not accept that model.`,
      );
    }
  } else {
    warning = `Saved without live validation because ${keyName} is not configured.`;
  }

  const { data: updated, error } = await supabase
    .from("ai_settings")
    .update({ model, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not save AI model: ${error.message}`);
  if (!updated) throw new Error("Could not save AI model: the settings row is missing.");

  revalidatePath("/admin/ai");
  return { warning };
}

export async function updateReportAiSettings(input: {
  systemPrompt: string;
  maxTokens: number;
  thinking: string;
  effort: string;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) throw new Error("Admin only.");

  const systemPrompt = input.systemPrompt.trim();
  if (systemPrompt.length > 20_000) {
    throw new Error("System prompt is too long (max 20000 characters).");
  }

  const maxTokens = Math.trunc(input.maxTokens);
  if (!Number.isFinite(maxTokens) || maxTokens < 1024 || maxTokens > 21_000) {
    // 21000 keeps the direct Anthropic adapter under the SDK's 10-minute timeout
    // guard ((3_600_000 * max_tokens) / 128_000 must stay under 600_000).
    throw new Error("Max output tokens must be between 1024 and 21000.");
  }

  const thinking = input.thinking === "adaptive" ? "adaptive" : "off";
  const effort =
    thinking === "adaptive" && ["low", "medium", "high", "xhigh", "max"].includes(input.effort)
      ? input.effort
      : null;

  const { data: updated, error } = await supabase
    .from("ai_settings")
    .update({
      report_system_prompt: systemPrompt.length ? systemPrompt : null,
      report_max_tokens: maxTokens,
      report_thinking: thinking,
      report_effort: effort,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not save coach-report settings: ${error.message}`);
  if (!updated) throw new Error("Could not save coach-report settings: the settings row is missing.");

  revalidatePath("/admin/ai");
}
