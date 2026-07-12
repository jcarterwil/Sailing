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
      if (selected.capabilities?.structured_outputs.supported === false) {
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

  const { error } = await supabase
    .from("ai_settings")
    .update({ model, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", true);
  if (error) throw new Error(`Could not save AI model: ${error.message}`);

  revalidatePath("/admin/ai");
  return { warning };
}
