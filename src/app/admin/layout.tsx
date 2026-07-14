import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { AdminNav } from "@/app/admin/admin-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Single gate + persistent shell for the whole /admin tree. Individual admin
 * pages render their own content into the main column and keep their own
 * defence-in-depth checks (the service-role client contract).
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) {
    throw new Error(`Could not check administrator access: ${error.message}`);
  }
  if (!isAdmin) redirect("/dashboard");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 md:flex-row md:gap-10 lg:px-12">
      <aside className="md:w-52 md:shrink-0">
        <div className="mb-3 flex items-center justify-between md:mb-4">
          <span className="inline-flex items-center gap-2 font-heading font-semibold">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Admin
          </span>
          <ThemeToggle />
        </div>
        <AdminNav />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
