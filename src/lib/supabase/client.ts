import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export function createClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  // Implicit flow: magic-link tokens arrive in the URL hash of whatever
  // browser opens the email link. PKCE breaks when the link is opened in a
  // different browser than the one that requested it, and the hosted email
  // templates (token_hash flow) are not editable without custom SMTP.
  return createBrowserClient<Database>(url, publishableKey, {
    auth: { flowType: "implicit" },
  });
}
