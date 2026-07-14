"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function createOwnedBoat(input: {
  name: string;
  sailNumber: string;
  boatClass: string;
}): Promise<{ boatId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const name = input.name.trim();
  const sailNumber = input.sailNumber.trim();
  const boatClass = input.boatClass.trim();
  if (!name) throw new Error("A boat name is required.");
  if (name.length > 120) throw new Error("Boat name must be 120 characters or fewer.");
  if (sailNumber.length > 80 || boatClass.length > 80) {
    throw new Error("Sail number and class must be 80 characters or fewer.");
  }

  const { data, error } = await supabase
    .from("boats")
    .insert({
      owner_id: user.id,
      created_by: user.id,
      name,
      sail_number: sailNumber || null,
      boat_class: boatClass || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create the boat: ${error.message}`);

  revalidatePath("/boats");
  revalidatePath("/dashboard");
  return { boatId: data.id };
}

/**
 * Owner (or admin) edit of a boat's identity. RLS on `boats` enforces
 * owner-or-admin for the UPDATE, and only admins may touch the claim columns,
 * so a plain authenticated update of name/sail/class is safe here.
 */
export async function updateBoatDetails(input: {
  boatId: string;
  name: string;
  sailNumber: string;
  boatClass: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required." };

  const name = input.name.trim();
  if (!name) return { error: "A boat name is required." };

  const { data, error } = await supabase
    .from("boats")
    .update({
      name,
      sail_number: input.sailNumber.trim() || null,
      boat_class: input.boatClass.trim() || null,
    })
    .eq("id", input.boatId)
    .select("id")
    .maybeSingle();
  if (error) return { error: `Could not save the boat: ${error.message}` };
  if (!data) return { error: "You don't have access to edit this boat." };

  revalidatePath(`/boats/${input.boatId}`);
  revalidatePath("/boats");
  revalidatePath("/dashboard");
  return { error: null };
}
