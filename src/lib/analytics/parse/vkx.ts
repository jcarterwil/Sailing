import { norm360 } from "@/lib/analytics/angles";
import {
  ParseError,
  type ParseWarning,
  type RawTrack,
  type RaceTimerEvent,
  type TrackPoint,
  type VkxExtras,
} from "@/lib/analytics/types";

// Vakaros VKX: flat little-endian stream of rows, each a 1-byte key followed
// by a fixed-size payload. Sizes per the official spec (github.com/vakaros/vkx),
// validated byte-for-byte against the Examples files (format version 0x05).
const ROW_PAYLOAD_BYTES: Record<number, number> = {
  0xff: 7, // page header: u8 format version + 6 internal
  0xfe: 2, // page terminator: u16 previous page length
  0x01: 32,
  0x02: 44, // position/velocity/orientation
  0x03: 20, // declination
  0x04: 13, // race timer event
  0x05: 17, // line position ping
  0x06: 18, // shift angle
  0x07: 12,
  0x08: 13, // device configuration (last byte = logging rate Hz)
  0x0a: 16, // apparent wind (Calypso)
  0x0b: 16, // speed through water
  0x0c: 12, // depth
  0x0e: 16,
  0x0f: 16, // load
  0x10: 12, // temperature
  0x20: 13,
  0x21: 52,
};

const MS_TO_KTS = 1.943844;
const MIN_PVO_ROWS = 120; // one minute at 2 Hz
const MAX_RESYNCS = 32;
const TIMER_EVENTS: RaceTimerEvent["event"][] = [
  "reset",
  "start",
  "sync",
  "race_start",
  "race_end",
];

// Body-to-NED ZYX Euler extraction; quaternion stored w,x,y,z in a true-NED
// frame, so yaw is true heading, pitch is trim (bow-up +), roll is heel
// (starboard-down +). Validated against the CSV export of the same device.
function quatToEuler(w: number, x: number, y: number, z: number) {
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - x * z))));
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const rad2deg = 180 / Math.PI;
  return { hdgDeg: norm360(yaw * rad2deg), trimDeg: pitch * rad2deg, heelDeg: roll * rad2deg };
}

function plausibleTs(ts: number, reference: number | null): boolean {
  if (!Number.isFinite(ts) || ts <= 0) return false;
  if (reference === null) {
    // Sanity window: 2001-01-01 .. 2100-01-01 in epoch ms.
    return ts > 978307200000 && ts < 4102444800000;
  }
  return Math.abs(ts - reference) < 24 * 3600 * 1000;
}

export function parseVkx(data: ArrayBuffer | Uint8Array): RawTrack {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;

  const points: TrackPoint[] = [];
  const warnings: ParseWarning[] = [];
  const extras: VkxExtras = {
    formatVersion: 0,
    loggingRateHz: null,
    timerEvents: [],
    linePings: [],
    windSamples: [],
    declinationDeg: null,
  };
  const declinations: number[] = [];

  let offset = 0;
  let refTs: number | null = null;
  let resyncs = 0;
  let badRows = 0;

  const readTs = (o: number) => Number(view.getBigUint64(o, true));

  while (offset < len) {
    const key = bytes[offset];
    const payload = ROW_PAYLOAD_BYTES[key];

    if (payload === undefined || offset + 1 + payload > len) {
      if (offset + 1 + (payload ?? 0) > len && payload !== undefined) {
        warnings.push({ code: "truncated-row", message: `truncated ${key.toString(16)} row at end of file`, byteOffset: offset });
        break;
      }
      // Unknown key: resync by scanning for the next plausible page header.
      badRows++;
      if (++resyncs > MAX_RESYNCS) {
        warnings.push({ code: "resync-limit", message: "too many corrupt regions; stopping", byteOffset: offset });
        break;
      }
      let next = offset + 1;
      while (next < len - 8) {
        if (
          bytes[next] === 0xff &&
          (extras.formatVersion === 0 || bytes[next + 1] === extras.formatVersion) &&
          ROW_PAYLOAD_BYTES[bytes[next + 8]] !== undefined
        ) {
          break;
        }
        next++;
      }
      warnings.push({
        code: "resync",
        message: `unknown key 0x${key.toString(16)}; skipped ${next - offset} bytes`,
        byteOffset: offset,
      });
      offset = next;
      continue;
    }

    const o = offset + 1;
    switch (key) {
      case 0xff:
        if (extras.formatVersion === 0) extras.formatVersion = bytes[o];
        break;
      case 0x02: {
        const t = readTs(o);
        if (!plausibleTs(t, refTs)) {
          badRows++;
          break;
        }
        refTs = t;
        const lat = view.getInt32(o + 8, true) * 1e-7;
        const lon = view.getInt32(o + 12, true) * 1e-7;
        const sogMs = view.getFloat32(o + 16, true);
        const cogRad = view.getFloat32(o + 20, true);
        const w = view.getFloat32(o + 28, true);
        const x = view.getFloat32(o + 32, true);
        const y = view.getFloat32(o + 36, true);
        const z = view.getFloat32(o + 40, true);
        const euler = quatToEuler(w, x, y, z);
        points.push({
          t,
          lat,
          lon,
          sogKts: sogMs * MS_TO_KTS,
          cogDeg: norm360((cogRad * 180) / Math.PI),
          hdgDeg: euler.hdgDeg,
          heelDeg: euler.heelDeg,
          trimDeg: euler.trimDeg,
        });
        break;
      }
      case 0x03:
        declinations.push((view.getFloat32(o + 8, true) * 180) / Math.PI);
        break;
      case 0x04: {
        const t = readTs(o);
        const eventCode = bytes[o + 8];
        if (plausibleTs(t, refTs) && eventCode < TIMER_EVENTS.length) {
          extras.timerEvents.push({
            t,
            event: TIMER_EVENTS[eventCode],
            timerSec: view.getInt32(o + 9, true),
          });
        }
        break;
      }
      case 0x05: {
        const t = readTs(o);
        if (plausibleTs(t, refTs)) {
          extras.linePings.push({
            t,
            end: bytes[o + 8] === 0 ? "pin" : "boat",
            lat: view.getFloat32(o + 9, true),
            lon: view.getFloat32(o + 13, true),
          });
        }
        break;
      }
      case 0x08:
        extras.loggingRateHz = bytes[o + 12];
        break;
      case 0x0a: {
        const t = readTs(o);
        if (plausibleTs(t, refTs)) {
          extras.windSamples.push({
            t,
            awaDeg: view.getFloat32(o + 8, true),
            awsMs: view.getFloat32(o + 12, true),
          });
        }
        break;
      }
      default:
        break; // internal/uninteresting rows
    }
    offset += 1 + payload;
  }

  if (badRows > 0) {
    warnings.push({ code: "bad-rows", message: "rows skipped for implausible data", count: badRows });
  }
  if (points.length < MIN_PVO_ROWS) {
    throw new ParseError(
      `Not a usable VKX log: only ${points.length} position rows decoded.`,
    );
  }

  if (declinations.length > 0) {
    const sorted = [...declinations].sort((a, b) => a - b);
    extras.declinationDeg = sorted[Math.floor(sorted.length / 2)];
  }

  points.sort((a, b) => a.t - b.t);
  const deduped: TrackPoint[] = [];
  for (const p of points) {
    if (deduped.length === 0 || p.t !== deduped[deduped.length - 1].t) deduped.push(p);
  }
  if (deduped.length < points.length) {
    warnings.push({
      code: "dup-timestamps",
      message: "duplicate timestamps dropped",
      count: points.length - deduped.length,
    });
  }

  return { points: deduped, source: "vkx", tzOffsetMinutes: null, extras, warnings };
}
