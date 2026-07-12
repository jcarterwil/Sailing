import Link from "next/link";
import { redirect } from "next/navigation";
import { Waves } from "lucide-react";

import { joinRace } from "@/app/races/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
            Enter the join code from your race organizer and name your boat. You can upload your
            track right after joining.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={joinRace} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="join-code">Join code</Label>
              <Input id="join-code" name="code" placeholder="e.g. 4f9b2c1a" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="boat-name">Your boat name</Label>
              <Input id="boat-name" name="boatName" placeholder="Rock Steady" required />
            </div>
            <Button type="submit" className="w-full">
              Join race
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
