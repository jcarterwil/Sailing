import Link from "next/link";
import { redirect } from "next/navigation";
import { Waves } from "lucide-react";

import { LoginForm } from "@/app/login/login-form";
import { getSafeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Sign in",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const rawNext = (await searchParams).next;
  const next = getSafeNextPath(Array.isArray(rawNext) ? rawNext[0] ?? null : rawNext ?? null);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(next);
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-md space-y-7">
        <Link
          href="/"
          className="mx-auto flex w-fit items-center gap-2 font-semibold tracking-tight"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Waves className="size-5" aria-hidden="true" />
          </span>
          Sailing
        </Link>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
