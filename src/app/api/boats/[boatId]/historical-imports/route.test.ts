import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMock, rpcMock, insertMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  rpcMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: insertMock,
    })),
  })),
}));

import { POST } from "@/app/api/boats/[boatId]/historical-imports/route";

function context(boatId = "11111111-1111-4111-8111-111111111111") {
  return { params: Promise.resolve({ boatId }) };
}

describe("POST historical-imports", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    rpcMock.mockReset();
    insertMock.mockReset();
  });

  it("rejects signed-out callers", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await POST(new Request("https://example.test"), context());
    expect(response).toBeDefined();
    expect(response!.status).toBe(401);
    await expect(response!.json()).resolves.toEqual({ error: "Not signed in." });
  });

  it("rejects viewers who cannot edit the boat", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpcMock.mockResolvedValue({ data: false, error: null });
    const response = await POST(new Request("https://example.test"), context());
    expect(response).toBeDefined();
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toEqual({ error: "Not allowed." });
    expect(rpcMock).toHaveBeenCalledWith("can_edit_boat", {
      bid: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("creates a draft batch for editors", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpcMock.mockResolvedValue({ data: true, error: null });
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "batch-1",
        boat_id: "11111111-1111-4111-8111-111111111111",
        status: "draft",
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
        committed_at: null,
        last_error: null,
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    insertMock.mockReturnValue({ select });

    const response = await POST(new Request("https://example.test"), context());
    expect(response).toBeDefined();
    expect(response!.status).toBe(201);
    const body = await response!.json();
    expect(body.id).toBe("batch-1");
    expect(body.status).toBe("draft");
    expect(body.items).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("staging");
  });
});
