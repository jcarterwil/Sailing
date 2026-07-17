import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingSettingsForm } from "@/app/admin/billing/billing-settings-form";
import { formatUsd } from "@/lib/billing/entitlements";
import { loadBillingSettings } from "@/lib/billing/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Billing" };

export default async function AdminBillingPage() {
  const settings = await loadBillingSettings();
  const environment = [
    ["Stripe secret key", !!process.env.STRIPE_SECRET_KEY],
    ["Webhook signing secret", !!process.env.STRIPE_WEBHOOK_SECRET],
    ["User product", !!process.env.STRIPE_USER_PRODUCT_ID],
    ["Club product", !!process.env.STRIPE_CLUB_PRODUCT_ID],
  ] as const;
  const ready = environment.every(([, configured]) => configured);

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
          <CardHeader><CardTitle>Environment</CardTitle><CardDescription>Secrets stay server-only; this page reports presence, never values.</CardDescription></CardHeader>
          <CardContent><ul className="space-y-2 text-sm">{environment.map(([label, configured]) => <li key={label} className="flex items-center justify-between gap-4"><span>{label}</span><Badge variant={configured ? "secondary" : "destructive"}>{configured ? "Configured" : "Missing"}</Badge></li>)}</ul></CardContent>
        </Card>
      </div>
    </div>
  );
}
