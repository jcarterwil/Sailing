import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import {
  IMPERSONATION_COOKIE,
  readExpiryUnverified,
} from "@/lib/auth/impersonation-cookie";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = getSupabasePublicEnv();
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  await supabase.auth.getClaims();

  // Enforce the impersonation hard time-cap. Clearing cookies is always safe,
  // so no signature check is needed here — a malformed cookie is just dropped.
  const impersonation = request.cookies.get(IMPERSONATION_COOKIE)?.value;
  if (impersonation) {
    const expiresAt = readExpiryUnverified(impersonation);
    if (expiresAt === null || Date.now() >= expiresAt) {
      response.cookies.delete(IMPERSONATION_COOKIE);
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token")) {
          response.cookies.delete(cookie.name);
        }
      }
    }
  }

  return response;
}
