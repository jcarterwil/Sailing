import "server-only";

import { loadSharedSeriesReportModelV1 } from "@/lib/series/report-server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Public series access is capability-only and never opens anonymous table policies. */
export async function resolveSharedSeriesReportV1(slug: string) {
  return loadSharedSeriesReportModelV1(createAdminClient(), slug);
}
