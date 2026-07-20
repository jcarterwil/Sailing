import { Check, Coins, Users } from "lucide-react";
import { redirect } from "next/navigation";

import { enrollEarlyAccess } from "@/app/account/billing/actions";
import {
  AiBudgetContributionButtons,
  BillingPortalButton,
  ClubContributionButton,
  UserCheckoutButton,
} from "@/app/account/billing/stripe-buttons";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/lib/billing/entitlements";
import {
  hasStripeBillingCustomer,
  loadBillingEntitlement,
  loadClubFunding,
} from "@/lib/billing/server";
import { getAiBudgetContributionConfiguration } from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Plans · Sailing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    activated?: string;
    checkout?: string;
    contribution?: string;
    raceId?: string;
  }>;
}) {
  const notice = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: races }, userBilling, clubBilling, hasCustomer] = await Promise.all([
    supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("races")
      .select("id, name, organizer_id")
      .order("created_at", { ascending: false }),
    loadBillingEntitlement("user", user.id),
    loadClubFunding(user.id),
    hasStripeBillingCustomer(user.id),
  ]);
  const settings = userBilling.settings;
  const contributionConfiguration = getAiBudgetContributionConfiguration();
  const organizedRaces = (races ?? []).filter((race) => race.organizer_id === user.id);
  const fundingRace =
    (races ?? []).find((race) => race.id === notice.raceId) ??
    organizedRaces[0] ??
    races?.[0] ??
    null;
  const funding = fundingRace
    ? fundingRace.organizer_id === user.id
      ? clubBilling
      : await loadClubFunding(fundingRace.organizer_id)
    : null;
  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="prose"
    >
      <PageHeader
        title="Plans"
        description="Race replay stays free. Add AI for a club's shared race reports or your personal boat performance."
      />
      <div className="space-y-6 py-8">
        {!settings.paymentsEnabled ? (
          <Alert>
            <Check className="size-4" />
            <AlertTitle>Free early access</AlertTitle>
            <AlertDescription>
              User and Club AI plans are free to activate right now. When payments launch,
              continuing requires a card and includes a {settings.trialDays}-day free trial.
            </AlertDescription>
          </Alert>
        ) : null}
        {notice.activated ? (
          <Alert><AlertTitle>Plan activated</AlertTitle><AlertDescription>Your {notice.activated} AI access is ready.</AlertDescription></Alert>
        ) : null}
        {notice.checkout === "success" ? (
          <Alert><AlertTitle>Stripe setup received</AlertTitle><AlertDescription>Your access updates as soon as Stripe confirms the subscription.</AlertDescription></Alert>
        ) : null}
        {notice.contribution === "success" ? (
          <Alert>
            <Coins className="size-4" />
            <AlertTitle>Thank you for supporting Sailing AI</AlertTitle>
            <AlertDescription>
              Your one-time contribution was completed and will fund model and voice usage.
            </AlertDescription>
          </Alert>
        ) : null}
        {notice.contribution === "canceled" ? (
          <Alert>
            <AlertTitle>Contribution canceled</AlertTitle>
            <AlertDescription>No payment was made.</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="bg-card/70">
            <CardHeader><CardTitle>Free</CardTitle><CardDescription>Race data for everyone</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-semibold">$0</p>
              <ul className="space-y-2 text-sm"><li>Upload race tracks</li><li>View and replay races</li><li>Shared factual race performance</li></ul>
              <Badge variant="secondary">Always included</Badge>
            </CardContent>
          </Card>

          <Card className="bg-card/70">
            <CardHeader><CardTitle>Club</CardTitle><CardDescription>Shared AI Race Dossiers</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-semibold">{formatUsd(settings.clubPriceCents)}<span className="text-sm font-normal text-muted-foreground"> / year</span></p>
              <p className="text-sm">One organizer’s plan covers AI summaries for every race they organize. Racers may split the annual total.</p>
              {clubBilling.allowed ? <Badge>Active</Badge> : null}
              {!settings.paymentsEnabled ? (
                clubBilling.allowed ? null : organizedRaces.length ? (
                  <form action={enrollEarlyAccess}><input type="hidden" name="kind" value="club" /><Button className="min-h-11 w-full" type="submit">Activate Club free</Button></form>
                ) : <p className="text-sm text-muted-foreground">Create a race to activate Club AI.</p>
              ) : fundingRace && funding ? (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium"><Users className="mr-1 inline size-4" />{fundingRace.name}</p>
                  <p className="text-sm text-muted-foreground">{formatUsd(funding.committedCents)} committed · {formatUsd(funding.remainingCents)} remaining</p>
                  {funding.remainingCents > 0 ? <ClubContributionButton raceId={fundingRace.id} remainingCents={funding.remainingCents} trialDays={settings.trialDays} /> : <Badge>Fully funded</Badge>}
                </div>
              ) : <p className="text-sm text-muted-foreground">Join a race to help fund its organizer’s Club AI.</p>}
            </CardContent>
          </Card>

          <Card className="bg-card/70">
            <CardHeader><CardTitle>User</CardTitle><CardDescription>Personal boat-performance AI</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-semibold">{formatUsd(settings.userPriceCents)}<span className="text-sm font-normal text-muted-foreground"> / year</span></p>
              <p className="text-sm">Generate cited AI coaching for any boat you own or edit.</p>
              {userBilling.allowed ? <Badge>Active</Badge> : null}
              {!userBilling.allowed ? (
                settings.paymentsEnabled ? <UserCheckoutButton trialDays={settings.trialDays} /> : (
                  <form action={enrollEarlyAccess}><input type="hidden" name="kind" value="user" /><Button className="min-h-11 w-full" type="submit">Activate User free</Button></form>
                )
              ) : null}
            </CardContent>
          </Card>
        </div>
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="size-5" />
              Support the AI budget
            </CardTitle>
            <CardDescription>
              Help cover the model and voice costs behind Race Dossiers and coaching.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AiBudgetContributionButtons
              enabled={contributionConfiguration.checkoutEnabled}
              mode={contributionConfiguration.mode}
            />
            <p className="text-xs text-muted-foreground">
              This is a one-time, non-renewing payment. It does not change your plan or
              unlock subscription access.
            </p>
          </CardContent>
        </Card>
        {hasCustomer ? <BillingPortalButton /> : null}
      </div>
    </AuthenticatedShell>
  );
}
