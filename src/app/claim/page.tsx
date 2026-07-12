import { Ticket } from "lucide-react";

import { ClaimForm } from "@/app/claim/claim-form";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Claim a boat",
};

export default async function ClaimPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-8">
      <div className="mb-6 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
          <Ticket className="size-5 text-primary" aria-hidden="true" />
          Claim a boat
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the claim code your organizer gave you to link the boat to your account.
        </p>
      </div>
      <ClaimForm />
    </main>
  );
}
