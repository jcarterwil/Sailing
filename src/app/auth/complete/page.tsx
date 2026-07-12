"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getSafeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/client";

// Landing page for implicit-flow auth redirects (email magic links and
// OAuth). Tokens arrive in the URL hash; instantiating the browser client
// consumes them and writes the session cookies, after which the server
// sees the user.
function CompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const hashError = hashParams.get("error_description") ?? hashParams.get("error");
    if (hashError) {
      queueMicrotask(() => setError(hashError.replaceAll("+", " ")));
      return;
    }

    const supabase = createClient();
    const next = getSafeNextPath(searchParams.get("next"));
    let settled = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (settled) return;
      if (session) {
        settled = true;
        router.replace(next);
      }
    });

    // Session may already be stored (e.g. re-clicked link in same browser).
    supabase.auth.getSession().then(({ data }) => {
      if (!settled && data.session) {
        settled = true;
        router.replace(next);
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        setError(
          "The sign-in link did not carry a valid session. It may have expired or already been used — request a new one.",
        );
      }
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router, searchParams]);

  if (error) {
    return (
      <Alert variant="destructive" className="max-w-md">
        <AlertTitle>Sign-in failed</AlertTitle>
        <AlertDescription>
          {error}{" "}
          <Link href="/login" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      Signing you in…
    </div>
  );
}

export default function AuthCompletePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense fallback={null}>
        <CompleteInner />
      </Suspense>
    </main>
  );
}
