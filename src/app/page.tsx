import Link from "next/link";
import { ArrowRight, BarChart3, ShieldCheck, Waves } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
      <nav className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Waves className="size-5" aria-hidden="true" />
          </span>
          Sailing
        </Link>
        <Button asChild variant="outline">
          <Link href="/login">Racer sign in</Link>
        </Button>
      </nav>

      <section className="flex flex-1 flex-col justify-center py-20 lg:py-28">
        <Badge variant="secondary" className="mb-6 w-fit">
          Built for club racing
        </Badge>
        <div className="max-w-3xl">
          <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            Understand how sailboats perform, race after race.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
            Compare boats across fleets and scoring systems, follow published club results,
            and keep a trusted history for every racer and boat.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/login">
                Access the racer app
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="#foundation">See the foundation</Link>
            </Button>
          </div>
        </div>
      </section>

      <section id="foundation" className="grid gap-4 pb-10 md:grid-cols-3">
        <FeatureCard
          icon={BarChart3}
          title="Comparable performance"
          description="A data foundation designed to support multiple handicap and scoring systems."
        />
        <FeatureCard
          icon={Waves}
          title="Club-first workflow"
          description="Public published results with protected racer and boat ownership tools."
        />
        <FeatureCard
          icon={ShieldCheck}
          title="Trusted access"
          description="Supabase authentication, server-side session checks, and row-level security."
        />
      </section>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof BarChart3;
  title: string;
  description: string;
}) {
  return (
    <Card className="bg-card/70 backdrop-blur-sm">
      <CardHeader>
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <CardTitle className="mt-3 text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  );
}
