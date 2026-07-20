import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserMock,
  fromMock,
  rpcMock,
  hasClubAiEntitlementMock,
  generateReplaySpeechMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  hasClubAiEntitlementMock: vi.fn(),
  generateReplaySpeechMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  })),
}));

vi.mock("@/lib/billing/server", () => ({
  hasClubAiEntitlement: hasClubAiEntitlementMock,
}));

vi.mock("@/lib/ai/speech", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/speech")>(
    "@/lib/ai/speech",
  );
  return {
    ...actual,
    generateReplaySpeech: generateReplaySpeechMock,
  };
});

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/races/[raceId]/replay/speech/route";

function context(raceId = "race-1") {
  return { params: Promise.resolve({ raceId }) };
}

function mockRaceRow() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { id: "race-1", organizer_id: "org-1" },
          error: null,
        }),
      }),
    }),
  };
}

describe("POST replay speech", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    hasClubAiEntitlementMock.mockReset();
    generateReplaySpeechMock.mockReset();
    rpcMock.mockResolvedValue({ data: false, error: null });
  });

  it("rejects signed-out callers", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ itemId: "event:a" }),
      }),
      context(),
    );
    expect(response!.status).toBe(401);
    expect(generateReplaySpeechMock).not.toHaveBeenCalled();
  });

  it("requires Club AI before spending TTS for non-admins", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    fromMock.mockImplementation((table: string) => {
      if (table === "races") return mockRaceRow();
      throw new Error(`unexpected table ${table}`);
    });
    hasClubAiEntitlementMock.mockResolvedValue(false);

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "event:a" }),
      }),
      context(),
    );
    expect(response!.status).toBe(402);
    expect(generateReplaySpeechMock).not.toHaveBeenCalled();
  });

  it("surfaces is_admin RPC failures instead of silently falling back", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    fromMock.mockImplementation((table: string) => {
      if (table === "races") return mockRaceRow();
      throw new Error(`unexpected table ${table}`);
    });
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc failed" } });

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "event:a" }),
      }),
      context(),
    );
    expect(response!.status).toBe(500);
    expect(hasClubAiEntitlementMock).not.toHaveBeenCalled();
    expect(generateReplaySpeechMock).not.toHaveBeenCalled();
  });

  it("lets admins spend TTS without Club AI", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    rpcMock.mockResolvedValue({ data: true, error: null });
    hasClubAiEntitlementMock.mockResolvedValue(false);
    fromMock.mockImplementation((table: string) => {
      if (table === "races") return mockRaceRow();
      if (table === "race_entries") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "race_analyses" || table === "race_corrections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "event:a" }),
      }),
      context(),
    );
    // Past the billing gate; missing analysis yields 409 without calling TTS.
    expect(response!.status).toBe(409);
    expect(hasClubAiEntitlementMock).not.toHaveBeenCalled();
    expect(generateReplaySpeechMock).not.toHaveBeenCalled();
  });
});
