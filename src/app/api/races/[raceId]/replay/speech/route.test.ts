import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserMock,
  fromMock,
  hasClubAiEntitlementMock,
  generateReplaySpeechMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  hasClubAiEntitlementMock: vi.fn(),
  generateReplaySpeechMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
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

describe("POST replay speech", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    fromMock.mockReset();
    hasClubAiEntitlementMock.mockReset();
    generateReplaySpeechMock.mockReset();
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

  it("requires Club AI before spending TTS", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    fromMock.mockImplementation((table: string) => {
      if (table === "races") {
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
});
