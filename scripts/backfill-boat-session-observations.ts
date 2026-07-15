/**
 * One-shot backfill of boat_session_observations from existing race_analyses.
 * Run: npx tsx scripts/backfill-boat-session-observations.ts [--boat <uuid>]
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY.
 */
import { backfillBoatSessionObservations } from "../src/lib/boats/performance-history/backfill";

async function main() {
  const boatArgIdx = process.argv.indexOf("--boat");
  const boatId = boatArgIdx >= 0 ? process.argv[boatArgIdx + 1] : undefined;
  const result = await backfillBoatSessionObservations({
    boatId,
    limit: 2000,
  });
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
