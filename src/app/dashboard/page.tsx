import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, CalendarDays, Sailboat, Waves } from "lucide-react";

import { SignOutButton } from "@/app/dashboard/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10 lg:px-12">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/" className="mb-4 flex w-fit items-center gap-2 font-semibold">
            <Waves className="size-5 text-primary" aria-hidden="true" />
            Sailing
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Racer dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <section className="py-8">
        <Badge variant="secondary">Foundation ready</Badge>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">
          Your racing workspace starts here.
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Boat claims, published results, and cross-system performance comparisons will build on
          this protected racer account.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <EmptyFeature icon={Sailboat} title="My boats" description="No boat claimed yet." />
          <EmptyFeature
            icon={CalendarDays}
            title="Race history"
            description="Published club races will appear here."
          />
          <EmptyFeature
            icon={BarChart3}
            title="Performance"
            description="Comparison metrics are coming next."
          />
        </div>

        <Button className="mt-8" disabled>
          Claim a boat
        </Button>
      </section>
    </main>
  );
}

function EmptyFeature({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Sailboat;
  title: string;
  description: string;
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <CardTitle className="mt-3 text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
