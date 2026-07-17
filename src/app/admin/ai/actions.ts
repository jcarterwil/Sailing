"use server";

import { revalidatePath } from "next/cache";

import { AI_FUNCTIONS, type AiFunction, type AiProvider } from "@/lib/ai/contracts";
import { validateAiModel } from "@/lib/ai/gateway";
import { createClient } from "@/lib/supabase/server";

export async function updateAiFunctionRoute(input: {
  function: string;
  provider: string;
  model: string;
  maxOutputTokens: number;
}): Promise<{ warning: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) throw new Error("Admin only.");

  if (!(AI_FUNCTIONS as readonly string[]).includes(input.function)) {
    throw new Error("Unknown AI function.");
  }
  const aiFunction = input.function as AiFunction;
  const provider: AiProvider = input.provider === "vercel" ? "vercel" : "anthropic";
  const model = input.model.trim();
  if (!model || model.length > 160 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    throw new Error("Enter a valid AI model ID.");
  }
  const maxOutputTokens = Math.trunc(input.maxOutputTokens);
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 100 || maxOutputTokens > 21_000) {
    throw new Error("Max output tokens must be between 100 and 21000.");
  }

  let warning: string | null = null;
  const keyName =
    provider === "vercel"
      ? "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN"
      : "ANTHROPIC_API_KEY";
  const apiKey =
    provider === "vercel"
      ? process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN
      : process.env.ANTHROPIC_API_KEY;
  if (provider === "vercel" && !apiKey) {
    throw new Error(
      "Vercel AI Gateway is not available in this environment. Configure AI_GATEWAY_API_KEY or deploy with Vercel OIDC before saving this route.",
    );
  }
  if (apiKey) {
    try {
      const selected = await validateAiModel(provider, model);
      if (
        selected.structuredOutputs === false &&
        (aiFunction === "weather_interpretation" || aiFunction === "wind_explanation")
      ) {
        throw new Error("This function requires a model that supports structured outputs.");
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
    .from("ai_function_routes")
    .update({
      provider,
      model,
      max_output_tokens: maxOutputTokens,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("function", aiFunction)
    .select("function")
    .maybeSingle();
  if (error) throw new Error(`Could not save AI route: ${error.message}`);
  if (!updated) throw new Error("Could not save AI route: the function row is missing.");

  revalidatePath("/admin/ai");
  return { warning };
}

export async function updateReportAiSettings(input: {
  systemPrompt: string;
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

  const thinking = input.thinking === "adaptive" ? "adaptive" : "off";
  const effort =
    thinking === "adaptive" && ["low", "medium", "high", "xhigh", "max"].includes(input.effort)
      ? input.effort
      : null;

  const { data: updated, error } = await supabase
    .from("ai_settings")
    .update({
      report_system_prompt: systemPrompt.length ? systemPrompt : null,
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
