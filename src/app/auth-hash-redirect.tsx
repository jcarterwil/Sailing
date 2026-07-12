"use client";

import { useEffect } from "react";

// Supabase falls back to redirecting to the Site URL (this landing page)
// with tokens or an error in the URL hash when a verify link can't honor
// its redirect_to. Forward those to /auth/complete instead of silently
// dropping the user on the marketing page.
export function AuthHashRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    if (/access_token|refresh_token|error/.test(hash)) {
      window.location.replace("/auth/complete?next=/dashboard" + hash);
    }
  }, []);

  return null;
}
