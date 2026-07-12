import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSafeNextPath, setPrivateNoStore } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      return setPrivateNoStore(NextResponse.redirect(new URL(next, requestUrl.origin)));
    }
  }

  return setPrivateNoStore(
    NextResponse.redirect(new URL("/auth/auth-code-error", requestUrl.origin)),
  );
}
