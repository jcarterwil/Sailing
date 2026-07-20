import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingSettingsForm } from "@/app/admin/billing/billing-settings-form";
import { formatUsd } from "@/lib/billing/entitlements";
import { loadBillingSettings } from "@/lib/billing/server";
import { getAiBudgetContributionConfiguration } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Billing" };

export default async function AdminBillingPage() {
  const settings = await loadBillingSettings();
  const contributions = getAiBudgetContributionConfiguration();
  const environment = [
    ["Stripe secret key", !!process.env.STRIPE_SECRET_KEY],
    ["Webhook signing secret", !!process.env.STRIPE_WEBHOOK_SECRET],
    ["User product", !!process.env.STRIPE_USER_PRODUCT_ID],
    ["Club product", !!process.env.STRIPE_CLUB_PRODUCT_ID],
  ] as const;
  const ready = environment.every(([, configured]) => configured);
  const contributionEnvironment = [
    ["Contribution secret key", !!process.env.STRIPE_CONTRIBUTION_SECRET_KEY],
    [
      "Contribution webhook signing secret",
      !!process.env.STRIPE_CONTRIBUTION_WEBHOOK_SECRET,
    ],
    ["Contribution product", !!process.env.STRIPE_CONTRIBUTION_PRODUCT_ID],
  ] as const;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Billing" description="Control the Stripe launch switch and verify production configuration." />
      <div className="space-y-6 py-8">
        <Card className="bg-card/70">
          <CardHeader><CardTitle>Payment mode</CardTitle><CardDescription>Turning payments on ends free early-access entitlement. Subscribers enter a card and receive a {settings.trialDays}-day trial.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Badge variant={settings.paymentsEnabled ? "default" : "secondary"}>{settings.paymentsEnabled ? "Payments enabled" : "Early access — no charge"}</Badge>
            <p className="text-sm">User {formatUsd(settings.userPriceCents)}/year · Club {formatUsd(settings.clubPriceCents)}/year</p>
            {!ready ? <p className="text-sm text-destructive">Configure every Stripe environment value before enabling payments.</p> : null}
            <BillingSettingsForm enabled={settings.paymentsEnabled} canEnable={ready} />
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>AI budget contributions</CardTitle>
            <CardDescription>
              Independent one-time $25, $50, or $100 payments. Contributions never
              grant a subscription entitlement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge
              variant={
                contributions.checkoutEnabled
                  ? "default"
                  : contributions.configured
                    ? "secondary"
                    : "destructive"
              }
            >
              {contributions.checkoutEnabled
                ? "Active · " + contributions.mode + " mode"
                : contributions.configured
                  ? "Configured · disabled"
                  : "Not configured"}
            </Badge>
            <ul className="space-y-2 text-sm">
              {contributionEnvironment.map(([label, configured]) => (
                <li
                  key={label}
                  className="flex items-center justify-between gap-4"
                >
                  <span>{label}</span>
                  <Badge variant={configured ? "secondary" : "destructive"}>
                    {configured ? "Configured" : "Missing"}
                  </Badge>
                </li>
              ))}
              <li className="flex items-center justify-between gap-4">
                <span>Contribution checkout switch</span>
                <Badge variant={contributions.enabled ? "secondary" : "destructive"}>
                  {contributions.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardHeader><CardTitle>Environment</CardTitle><CardDescription>Secrets stay server-only; this page reports presence, never values.</CardDescription></CardHeader>
          <CardContent><ul className="space-y-2 text-sm">{environment.map(([label, configured]) => <li key={label} className="flex items-center justify-between gap-4"><span>{label}</span><Badge variant={configured ? "secondary" : "destructive"}>{configured ? "Configured" : "Missing"}</Badge></li>)}</ul></CardContent>
        </Card>
      </div>
    </div>
  );
}
