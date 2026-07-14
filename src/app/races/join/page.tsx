import Link from "next/link";
import { redirect } from "next/navigation";
import { Waves } from "lucide-react";

import { JoinRaceForm } from "@/app/races/join/join-race-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listActiveEditableBoats } from "@/lib/boats/active-boats";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Join a race",
};

export default async function JoinRacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/races/join");
  }
  const boats = await listActiveEditableBoats(supabase, user.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-10">
      <Link href="/dashboard" className="mb-6 flex w-fit items-center gap-2 font-semibold">
        <Waves className="size-5 text-primary" aria-hidden="true" />
        Sailing
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Join a race</CardTitle>
          <CardDescription>
            Enter the organizer&apos;s code, then reuse a boat you own or may edit. Create a new boat
            only when it is a different physical boat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JoinRaceForm boats={boats} />
        </CardContent>
      </Card>
    </main>
  );
}
