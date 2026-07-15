"use client";

import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/** PUT a historical-import file to a server-minted signed URL (no path/token in UI). */
export async function uploadHistoricalImportFile({
  signedUrl,
  file,
  onProgress,
}: {
  signedUrl: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { publishableKey } = getSupabasePublicEnv();
  const {
    data: { session },
  } = await createClient().auth.getSession();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("apikey", publishableKey);
    xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token ?? publishableKey}`);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.addEventListener("progress", (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error("Upload was rejected. Try again."));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload connection failed.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}
