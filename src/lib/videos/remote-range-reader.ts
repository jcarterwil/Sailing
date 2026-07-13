import "server-only";

import { VIDEO_BUCKET } from "@/lib/videos/upload";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RangeReader } from "@/lib/videos/mp4-timing";

export async function createVideoRangeReader(path: string): Promise<RangeReader> {
  const admin = createAdminClient();
  const { data: info, error: infoError } = await admin.storage.from(VIDEO_BUCKET).info(path);
  if (infoError || !info?.size) throw new Error("Could not inspect private video object.");
  const objectSize = info.size;

  const { data: signed, error: signError } = await admin.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, 60);
  if (signError || !signed) throw new Error("Could not create processing read URL.");

  return {
    size: objectSize,
    async read(start, endInclusive) {
      if (start < 0 || endInclusive < start || endInclusive >= objectSize) {
        throw new Error("Invalid bounded video read range.");
      }
      const response = await fetch(signed.signedUrl, {
        headers: { Range: `bytes=${start}-${endInclusive}` },
      });
      if (response.status !== 206) {
        throw new Error("Could not read private video range.");
      }
      const body = new Uint8Array(await response.arrayBuffer());
      const expected = endInclusive - start + 1;
      if (body.byteLength > expected) throw new Error("Private video read limit exceeded.");
      return body;
    },
  };
}
