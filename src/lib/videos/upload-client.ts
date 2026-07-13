"use client";

import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function uploadVideoWithProgress({
  signedUrl,
  file,
  onProgress,
}: {
  signedUrl: string;
  file: File;
  onProgress: (percent: number) => void;
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
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error("Supabase rejected the video upload."));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Video upload connection failed.")));
    xhr.addEventListener("abort", () => reject(new Error("Video upload was cancelled.")));

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}
