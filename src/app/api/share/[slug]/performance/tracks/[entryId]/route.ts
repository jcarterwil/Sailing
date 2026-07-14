import { PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES } from "@/components/performance/drilldown-data";
import { resolveSharedRace } from "@/lib/races/share";

export const dynamic = "force-dynamic";

function notFoundResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Revocation-checked gzip proxy; Storage paths and credentials stay server-side. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; entryId: string }> },
) {
  const { slug, entryId } = await params;
  if (slug.length > 200 || entryId.length > 200) return notFoundResponse();
  const { admin, race } = await resolveSharedRace(slug);
  if (!race) return notFoundResponse();

  const { data: entry, error } = await admin
    .from("race_entries")
    .select("id, tracks(processed_path, status)")
    .eq("race_id", race.id)
    .eq("id", entryId)
    .maybeSingle();
  if (error || !entry || entry.tracks?.status !== "processed" || !entry.tracks.processed_path) {
    return notFoundResponse();
  }

  const { data, error: downloadError } = await admin.storage
    .from("race-tracks-processed")
    .download(entry.tracks.processed_path);
  if (downloadError || !data) return notFoundResponse();
  if (data.size > PERFORMANCE_DRILLDOWN_MAX_COMPRESSED_BYTES) {
    return new Response("Track exceeds the public drilldown limit", {
      status: 413,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(data.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
