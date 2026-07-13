"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

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
  if (!model || model.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(model)) {
    throw new Error("Enter a valid Anthropic model ID.");
  }

  let warning: string | null = null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const selected = await new Anthropic({ apiKey }).models.retrieve(model);
      if (selected.capabilities?.structured_outputs?.supported === false) {
        throw new Error("This model does not support structured outputs required by the weather wizard.");
      }
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Anthropic did not accept that model: ${error.message}`
          : "Anthropic did not accept that model.",
      );
    }
  } else {
    warning = "Saved without live validation because ANTHROPIC_API_KEY is not configured.";
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
    // 21000 keeps the non-streaming Anthropic request under the SDK's 10-minute
    // timeout guard ((3_600_000 * max_tokens) / 128_000 must stay under 600_000).
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
