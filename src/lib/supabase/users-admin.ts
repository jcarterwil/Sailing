import "server-only";

import type { User } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

const USERS_PER_PAGE = 1000;

export async function listAllAuthUsers(): Promise<User[]> {
  const admin = createAdminClient();
  const users: User[] = [];

  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < USERS_PER_PAGE) return users;
  }
}

export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  const users = await listAllAuthUsers();
  return users.find((user) => (user.email ?? "").toLowerCase() === normalized) ?? null;
}

export async function getAuthUsersByIds(userIds: string[]): Promise<User[]> {
  const admin = createAdminClient();
  const uniqueIds = [...new Set(userIds)];
  const results = await Promise.all(
    uniqueIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) throw new Error(`Could not load user ${userId}: ${error.message}`);
      return data.user;
    }),
  );
  return results;
}
