import { norm360 } from "@/lib/analytics/angles";
import {
  ParseError,
  type ParseWarning,
  type RawTrack,
  type TrackPoint,
} from "@/lib/analytics/types";

const REQUIRED_COLUMNS = [
  "timestamp",
  "latitude",
  "longitude",
  "sog_kts",
  "cog",
  "hdg_true",
  "heel",
  "trim",
] as const;

// ISO-8601 with offset, tolerating the no-colon form Vakaros exports
// (2026-07-07T16:05:41.092-0500). Date.parse handles that inconsistently
// across engines, so parse strictly ourselves.
const TS_RE =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(\.\d{1,3})?(?:Z|([+-])(\d\d):?(\d\d))$/;

function parseTimestamp(value: string): { epochMs: number; offsetMinutes: number } | null {
  const m = TS_RE.exec(value);
  if (!m) return null;
  const [, yr, mo, dy, hh, mm, ss, frac, sign, oh, om] = m;
  const ms = frac ? Math.round(parseFloat(frac) * 1000) : 0;
  const utc = Date.UTC(+yr, +mo - 1, +dy, +hh, +mm, +ss, ms);
  const offsetMinutes = sign ? (sign === "-" ? -1 : 1) * (+oh * 60 + +om) : 0;
  return { epochMs: utc - offsetMinutes * 60_000, offsetMinutes };
}

export function parseTrackCsv(text: string): RawTrack {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new ParseError("Empty CSV file.");

  const header = lines[0].trim().toLowerCase().split(",").map((h) => h.trim());
  const col: Record<string, number> = {};
  header.forEach((name, i) => {
    col[name] = i;
  });
  for (const required of REQUIRED_COLUMNS) {
    if (!(required in col)) {
      throw new ParseError(
        `CSV is missing required column "${required}". Expected a Vakaros track export with columns: ${REQUIRED_COLUMNS.join(", ")}.`,
      );
    }
  }

  const points: TrackPoint[] = [];
  const warnings: ParseWarning[] = [];
  let badRows = 0;
  let dupRows = 0;
  let tzOffsetMinutes: number | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split(",");
    if (cells.length < header.length) {
      badRows++;
      continue;
    }
    const ts = parseTimestamp(cells[col.timestamp].trim());
    const lat = parseFloat(cells[col.latitude]);
    const lon = parseFloat(cells[col.longitude]);
    const sog = parseFloat(cells[col.sog_kts]);
    const cog = parseFloat(cells[col.cog]);
    const hdg = parseFloat(cells[col.hdg_true]);
    const heel = parseFloat(cells[col.heel]);
    const trim = parseFloat(cells[col.trim]);

    if (
      !ts ||
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      !Number.isFinite(sog) || sog < 0 || sog >= 60 ||
      !Number.isFinite(cog) || !Number.isFinite(hdg) ||
      !Number.isFinite(heel) || !Number.isFinite(trim)
    ) {
      badRows++;
      continue;
    }

    if (tzOffsetMinutes === null) tzOffsetMinutes = ts.offsetMinutes;
    if (points.length > 0 && ts.epochMs <= points[points.length - 1].t) {
      if (ts.epochMs === points[points.length - 1].t) {
        dupRows++;
        continue;
      }
    }
    points.push({
      t: ts.epochMs,
      lat,
      lon,
      sogKts: sog,
      cogDeg: norm360(cog),
      hdgDeg: norm360(hdg),
      heelDeg: heel,
      trimDeg: trim,
    });
  }

  if (points.length < 120) {
    throw new ParseError(`Not a usable track CSV: only ${points.length} valid rows.`);
  }
  points.sort((a, b) => a.t - b.t);
  if (badRows > 0) warnings.push({ code: "bad-rows", message: "malformed rows skipped", count: badRows });
  if (dupRows > 0) warnings.push({ code: "dup-timestamps", message: "duplicate timestamps dropped", count: dupRows });

  return { points, source: "csv", tzOffsetMinutes, extras: null, warnings };
}
