export const BOAT_CREW_ROLES = ["viewer", "editor"] as const;

export type BoatCrewRole = (typeof BOAT_CREW_ROLES)[number];

export function isBoatCrewRole(value: string): value is BoatCrewRole {
  return BOAT_CREW_ROLES.includes(value as BoatCrewRole);
}

export type AccountStatus = "active" | "confirmed" | "invited";

export function getAccountStatus(
  emailConfirmedAt: string | null | undefined,
  lastSignInAt: string | null | undefined,
): AccountStatus {
  if (lastSignInAt) return "active";
  if (emailConfirmedAt) return "confirmed";
  return "invited";
}

export function accountStatusLabel(status: AccountStatus): string {
  if (status === "active") return "Active";
  if (status === "confirmed") return "Confirmed";
  return "Invited";
}
