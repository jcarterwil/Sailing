import "server-only";

import type { User } from "@supabase/supabase-js";

import { isNotificationAllowed, DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/email/preferences";
import type {
  EmailRecipient,
  NotificationPreferenceSnapshot,
  PreferenceControlledEmailCategory,
  RecipientResolution,
} from "@/lib/email/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllAuthUsers } from "@/lib/supabase/users-admin";

const QUERY_CHUNK_SIZE = 500;

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += QUERY_CHUNK_SIZE) {
    result.push(values.slice(index, index + QUERY_CHUNK_SIZE));
  }
  return result;
}

function toPreferenceSnapshot(
  row:
    | {
        email_enabled: boolean;
        admin_announcements: boolean;
        boat_activity: boolean;
        report_ready: boolean;
        suppressed_at: string | null;
        suppression_reason: string | null;
      }
    | undefined,
): NotificationPreferenceSnapshot {
  if (!row) return DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    emailEnabled: row.email_enabled,
    adminAnnouncements: row.admin_announcements,
    boatActivity: row.boat_activity,
    reportReady: row.report_ready,
    suppressedAt: row.suppressed_at,
    suppressionReason: row.suppression_reason,
  };
}

async function resolveUserIds(
  candidateUserIds: Iterable<string>,
  category: PreferenceControlledEmailCategory,
  loadedAuthUsers?: User[],
): Promise<RecipientResolution> {
  const ids = [...new Set(candidateUserIds)];
  if (ids.length === 0) return { eligible: [], skippedCount: 0 };

  const admin = createAdminClient();
  const authUsers = loadedAuthUsers ?? (await listAllAuthUsers());
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const profileRows: { id: string; display_name: string | null }[] = [];
  const preferenceRows: {
    user_id: string;
    email_enabled: boolean;
    admin_announcements: boolean;
    boat_activity: boolean;
    report_ready: boolean;
    suppressed_at: string | null;
    suppression_reason: string | null;
  }[] = [];

  await Promise.all(
    chunks(ids).map(async (group) => {
      const [profilesResult, preferencesResult] = await Promise.all([
        admin.from("profiles").select("id, display_name").in("id", group),
        admin
          .from("notification_preferences")
          .select(
            "user_id, email_enabled, admin_announcements, boat_activity, report_ready, suppressed_at, suppression_reason",
          )
          .in("user_id", group),
      ]);
      if (profilesResult.error) {
        throw new Error(`Could not load recipient profiles: ${profilesResult.error.message}`);
      }
      if (preferencesResult.error) {
        throw new Error(
          `Could not load notification preferences: ${preferencesResult.error.message}`,
        );
      }
      profileRows.push(...(profilesResult.data ?? []));
      preferenceRows.push(...(preferencesResult.data ?? []));
    }),
  );

  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const preferenceById = new Map(preferenceRows.map((row) => [row.user_id, row]));
  const eligible: EmailRecipient[] = [];
  let skippedCount = 0;

  for (const userId of ids) {
    const authUser = authById.get(userId);
    const email = authUser?.email?.trim().toLowerCase();
    const profile = profileById.get(userId);
    const preferences = toPreferenceSnapshot(preferenceById.get(userId));
    if (!email || !profile || !isNotificationAllowed(preferences, category)) {
      skippedCount += 1;
      continue;
    }
    eligible.push({
      key: userId,
      email,
      userId,
      displayName: profile.display_name,
    });
  }

  return { eligible, skippedCount };
}

export async function resolveAllMemberRecipients(
  category: PreferenceControlledEmailCategory,
): Promise<RecipientResolution> {
  const users = await listAllAuthUsers();
  return resolveUserIds(
    users.map((user) => user.id),
    category,
    users,
  );
}

export async function resolveBoatRecipients(
  boatId: string,
  category: PreferenceControlledEmailCategory,
): Promise<RecipientResolution> {
  const admin = createAdminClient();
  const [boatResult, membershipsResult] = await Promise.all([
    admin.from("boats").select("owner_id, created_by").eq("id", boatId).maybeSingle(),
    admin.from("boat_memberships").select("user_id").eq("boat_id", boatId),
  ]);
  if (boatResult.error) throw new Error(`Could not load boat owner: ${boatResult.error.message}`);
  if (!boatResult.data) throw new Error("Boat not found.");
  if (membershipsResult.error) {
    throw new Error(`Could not load boat members: ${membershipsResult.error.message}`);
  }

  return resolveUserIds(
    [
      ...(boatResult.data.owner_id
        ? [boatResult.data.owner_id]
        : [boatResult.data.created_by]),
      ...(membershipsResult.data ?? []).map((membership) => membership.user_id),
    ],
    category,
  );
}

export async function resolveIndividualRecipient(
  userId: string,
  category: PreferenceControlledEmailCategory,
): Promise<RecipientResolution> {
  return resolveUserIds([userId], category);
}

export async function resolveRaceRecipients(
  raceId: string,
  category: PreferenceControlledEmailCategory,
): Promise<RecipientResolution> {
  const admin = createAdminClient();
  const [raceResult, entriesResult] = await Promise.all([
    admin.from("races").select("organizer_id").eq("id", raceId).maybeSingle(),
    admin
      .from("race_entries")
      .select("added_by, boat_id, boats(owner_id, boat_memberships(user_id))")
      .eq("race_id", raceId),
  ]);
  if (raceResult.error) throw new Error(`Could not load race: ${raceResult.error.message}`);
  if (!raceResult.data) throw new Error("Race not found.");
  if (entriesResult.error) {
    throw new Error(`Could not load race members: ${entriesResult.error.message}`);
  }

  const userIds = new Set<string>([raceResult.data.organizer_id]);
  for (const entry of entriesResult.data ?? []) {
    userIds.add(entry.added_by);
    if (entry.boats?.owner_id) userIds.add(entry.boats.owner_id);
    for (const membership of entry.boats?.boat_memberships ?? []) {
      userIds.add(membership.user_id);
    }
  }
  return resolveUserIds(userIds, category);
}
