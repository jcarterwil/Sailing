import { redirect } from "next/navigation";

import { NotificationPreferencesForm } from "@/app/account/notifications/notification-preferences-form";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/email/preferences";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Email notifications · Sailing",
};

export default async function NotificationPreferencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileResult, preferenceResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("notification_preferences")
      .select(
        "email_enabled, admin_announcements, boat_activity, report_ready, suppressed_at, suppression_reason",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(`Could not load profile: ${profileResult.error.message}`);
  if (preferenceResult.error?.code === "42P01") {
    return (
      <AuthenticatedShell
        email={user.email ?? ""}
        displayName={profileResult.data?.display_name}
        isAdmin={profileResult.data?.is_admin ?? false}
        width="prose"
      >
        <PageHeader
          title="Email notifications"
          description="Choose which Sailing updates can be sent to your account email."
        />
        <section className="py-8">
          <Card className="bg-card/70">
            <CardHeader>
              <CardTitle>Email preferences are being deployed</CardTitle>
              <CardDescription>
                The pending Supabase migration has not reached this environment yet. Refresh after
                it is applied; existing application features are unaffected.
              </CardDescription>
            </CardHeader>
          </Card>
        </section>
      </AuthenticatedShell>
    );
  }
  if (preferenceResult.error) {
    throw new Error(`Could not load email preferences: ${preferenceResult.error.message}`);
  }
  const row = preferenceResult.data;
  const preferences = row
    ? {
        emailEnabled: row.email_enabled,
        adminAnnouncements: row.admin_announcements,
        boatActivity: row.boat_activity,
        reportReady: row.report_ready,
      }
    : {
        emailEnabled: DEFAULT_NOTIFICATION_PREFERENCES.emailEnabled,
        adminAnnouncements: DEFAULT_NOTIFICATION_PREFERENCES.adminAnnouncements,
        boatActivity: DEFAULT_NOTIFICATION_PREFERENCES.boatActivity,
        reportReady: DEFAULT_NOTIFICATION_PREFERENCES.reportReady,
      };

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profileResult.data?.display_name}
      isAdmin={profileResult.data?.is_admin ?? false}
      width="prose"
    >
      <PageHeader
        title="Email notifications"
        description="Choose which Sailing updates can be sent to your account email."
      />
      <section className="py-8">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle>Application messages</CardTitle>
            <CardDescription>
              These settings do not disable account confirmation, password reset, or other
              security messages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationPreferencesForm
              initial={preferences}
              suppressedReason={row?.suppression_reason ?? null}
            />
          </CardContent>
        </Card>
      </section>
    </AuthenticatedShell>
  );
}
