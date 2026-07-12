"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isBoatCrewRole, type BoatCrewRole } from "@/lib/users/access";

async function requireAdminActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`Could not check administrator access: ${error.message}`);
  if (!isAdmin) throw new Error("Administrator access required.");
  return user;
}

function revalidateUserAccess(boatId?: string) {
  revalidatePath("/admin/users");
  revalidatePath("/admin/boats");
  revalidatePath("/dashboard");
  revalidatePath("/races/[raceId]", "page");
  revalidatePath("/races/[raceId]/replay", "page");
  if (boatId) revalidatePath(`/boats/${boatId}/crew`);
}

export async function updateUserAdminAccess(targetUserId: string, makeAdmin: boolean) {
  const actor = await requireAdminActor();
  if (actor.id === targetUserId && !makeAdmin) {
    throw new Error("You cannot remove your own administrator access.");
  }

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .update({ is_admin: makeAdmin })
    .eq("id", targetUserId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not update administrator access: ${error.message}`);
  if (!profile) throw new Error("User profile not found.");

  revalidateUserAccess();
}

export async function updateUserBoatAccess(
  targetUserId: string,
  boatId: string,
  role: BoatCrewRole | null,
) {
  const actor = await requireAdminActor();
  if (role !== null && !isBoatCrewRole(role)) {
    throw new Error("Choose no access, viewer, or editor.");
  }

  const admin = createAdminClient();
  const [boatResult, profileResult] = await Promise.all([
    admin.from("boats").select("id, owner_id").eq("id", boatId).maybeSingle(),
    admin.from("profiles").select("id").eq("id", targetUserId).maybeSingle(),
  ]);
  if (boatResult.error) throw new Error(`Could not load boat: ${boatResult.error.message}`);
  if (profileResult.error) throw new Error(`Could not load user: ${profileResult.error.message}`);
  if (!boatResult.data) throw new Error("Boat not found.");
  if (!profileResult.data) throw new Error("User profile not found.");
  if (boatResult.data.owner_id === targetUserId) {
    throw new Error("Boat owners already have full access and cannot also be crew.");
  }

  if (role === null) {
    const { error } = await admin
      .from("boat_memberships")
      .delete()
      .eq("boat_id", boatId)
      .eq("user_id", targetUserId);
    if (error) throw new Error(`Could not remove boat access: ${error.message}`);
  } else {
    const { error } = await admin.from("boat_memberships").upsert(
      {
        boat_id: boatId,
        user_id: targetUserId,
        role,
        invited_by: actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "boat_id,user_id" },
    );
    if (error) throw new Error(`Could not update boat access: ${error.message}`);
  }

  revalidateUserAccess(boatId);
}
