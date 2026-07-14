import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const adminActions = readFileSync(
  resolve(process.cwd(), "src/app/admin/actions.ts"),
  "utf8",
);
const raceActions = readFileSync(
  resolve(process.cwd(), "src/app/races/actions.ts"),
  "utf8",
);

describe("boat owner invitation action boundaries", () => {
  it("emails new and existing users into the same acceptance flow", () => {
    const sender = adminActions.slice(
      adminActions.indexOf("async function sendBoatOwnerInvitation"),
      adminActions.indexOf("export async function inviteBoatOwner"),
    );

    expect(sender).toContain("getOwnerInvitationPath(boat.claim_code)");
    expect(sender).toContain("getAuthCompletionPath(next)");
    expect(sender).toContain("inviteUserByEmail(boat.claim_email");
    expect(sender).toContain("signInWithOtp");
    expect(sender).toContain("shouldCreateUser: false");
    expect(sender).not.toContain("owner_id: existingUser.id");
  });

  it("accepts ownership only through the atomic database function", () => {
    const claimByCode = raceActions.slice(
      raceActions.indexOf("export async function claimBoatByCode"),
      raceActions.indexOf("export async function updateEntryMeta"),
    );

    expect(claimByCode).toContain('supabase.rpc("accept_boat_owner_invitation"');
    expect(claimByCode).not.toContain("createAdminClient()");
    expect(claimByCode).not.toContain(".update(");
  });
});
