import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveSharedRaceMock } = vi.hoisted(() => ({
  resolveSharedRaceMock: vi.fn(),
}));

vi.mock("@/lib/races/share", () => ({
  resolveSharedRace: resolveSharedRaceMock,
}));

import { GET } from "@/app/api/share/[slug]/performance/tracks/[entryId]/route";

function context(slug = "live-share", entryId = "entry-a") {
  return { params: Promise.resolve({ slug, entryId }) };
}

function adminWithTrack(blob: Blob | null, entry: object | null = {
  id: "entry-a",
  tracks: { status: "processed", processed_path: "private/object/path.json.gz" },
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: entry, error: null });
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const download = vi.fn().mockResolvedValue({ data: blob, error: blob ? null : new Error("missing") });
  return {
    admin: {
      from: vi.fn(() => ({ select })),
      storage: { from: vi.fn(() => ({ download })) },
    },
    download,
    firstEq,
    secondEq,
  };
}

describe("public performance track proxy", () => {
  beforeEach(() => resolveSharedRaceMock.mockReset());

  it("returns the same not-found response after share revocation without touching Storage", async () => {
    resolveSharedRaceMock.mockResolvedValue({ admin: {}, race: null });
    const response = await GET(new Request("https://example.test"), context());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("checks the shared race and entry pair before proxying a bounded no-store gzip", async () => {
    const fixture = new Blob([new Uint8Array([31, 139, 8, 0])], { type: "application/gzip" });
    const mocked = adminWithTrack(fixture);
    resolveSharedRaceMock.mockResolvedValue({
      admin: mocked.admin,
      race: { id: "race-a", share_slug: "live-share" },
    });
    const response = await GET(new Request("https://example.test"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gzip");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([31, 139, 8, 0]));
    expect(mocked.firstEq).toHaveBeenCalledWith("race_id", "race-a");
    expect(mocked.secondEq).toHaveBeenCalledWith("id", "entry-a");
    expect(mocked.download).toHaveBeenCalledWith("private/object/path.json.gz");
  });

  it("returns not found for an unavailable entry and never downloads a path", async () => {
    const mocked = adminWithTrack(null, null);
    resolveSharedRaceMock.mockResolvedValue({
      admin: mocked.admin,
      race: { id: "race-a", share_slug: "live-share" },
    });
    const response = await GET(new Request("https://example.test"), context());
    expect(response.status).toBe(404);
    expect(mocked.download).not.toHaveBeenCalled();
  });
});
