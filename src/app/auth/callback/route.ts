import { NextResponse } from "next/server";

import { getSafeNextPath, setPrivateNoStore } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return setPrivateNoStore(NextResponse.redirect(new URL(next, requestUrl.origin)));
    }
  }

  return setPrivateNoStore(
    NextResponse.redirect(new URL("/auth/auth-code-error", requestUrl.origin)),
  );
}
