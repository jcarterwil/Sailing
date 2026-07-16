import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMock, rpcMock, fromMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
    from: fromMock,
  })),
}));

import { GET } from "@/app/api/boats/[boatId]/performance-history/route";

function context(boatId = "11111111-1111-4111-8111-111111111111") {
  return { params: Promise.resolve({ boatId }) };
}

function observationSelectMock(rows: unknown[] = []) {
  const builder: {
    eq: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  builder.eq.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.lte.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  const select = vi.fn(() => builder);
  fromMock.mockReturnValue({ select });
  return { select, builder };
}

describe("GET performance-history", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("rejects anonymous callers", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await GET(new Request("https://example.test"), context());
    expect(response).toBeDefined();
    expect(response!.status).toBe(401);
    await expect(response!.json()).resolves.toEqual({ error: "Not signed in." });
  });

  it("rejects non-members", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpcMock.mockResolvedValue({ data: false, error: null });
    const response = await GET(new Request("https://example.test"), context());
    expect(response).toBeDefined();
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toEqual({ error: "Not allowed." });
    expect(rpcMock).toHaveBeenCalledWith("can_view_boat", {
      bid: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("returns history for boat viewers without requiring editor", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpcMock.mockResolvedValue({ data: true, error: null });
    observationSelectMock([]);

    const response = await GET(
      new Request("https://example.test/api/boats/x/performance-history?sessionType=race"),
      context(),
    );
    expect(response).toBeDefined();
    expect(response!.status).toBe(200);
    const body = await response!.json();
    expect(body.boatId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.n).toBe(0);
    expect(body.bound.maxSessions).toBe(250);
    expect(body.filters.sessionType).toBe("race");
    expect(body.units.speed).toBe("kts");
    expect(rpcMock).toHaveBeenCalledWith("can_view_boat", {
      bid: "11111111-1111-4111-8111-111111111111",
    });
    expect(rpcMock).not.toHaveBeenCalledWith("can_edit_boat", expect.anything());
    // Response must stay compact — no storage paths.
    expect(JSON.stringify(body)).not.toMatch(/processed_path|raw_path|staging/);
  });
});
