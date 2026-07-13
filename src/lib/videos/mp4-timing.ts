import { sanitizeVideoProcessingError, type VideoExtractionResult } from "@/lib/videos/timing";

const RANGE_BYTES = 256 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;
const MAX_MOOV_BYTES = 8 * 1024 * 1024;
const MAX_TELEMETRY_SAMPLES = 16;
const MAX_TELEMETRY_BYTES = 2 * 1024 * 1024;

export interface RangeReader {
  size: number;
  read(start: number, endInclusive: number): Promise<Uint8Array>;
}

interface BoxRef {
  start: number;
  size: number;
  headerSize: number;
  type: string;
}

function ascii(bytes: Uint8Array) {
  return new TextDecoder("latin1").decode(bytes);
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, false);
}

function u64(view: DataView, offset: number) {
  const value = view.getBigUint64(offset, false);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MP4 box exceeded safe limits.");
  return Number(value);
}

function boxAt(bytes: Uint8Array, start: number, limit = bytes.byteLength): BoxRef | null {
  if (start < 0 || start + 8 > limit) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = u32(view, start);
  const type = ascii(bytes.subarray(start + 4, start + 8));
  const headerSize = size32 === 1 ? 16 : 8;
  if (start + headerSize > limit) return null;
  const size = size32 === 0 ? limit - start : size32 === 1 ? u64(view, start + 8) : size32;
  if (size < headerSize || start + size > limit) return null;
  return { start, size, headerSize, type };
}

function childBoxes(bytes: Uint8Array, parent: BoxRef) {
  const children: BoxRef[] = [];
  const limit = parent.start + parent.size;
  let cursor = parent.start + parent.headerSize;
  while (cursor + 8 <= limit) {
    const child = boxAt(bytes, cursor, limit);
    if (!child) break;
    children.push(child);
    cursor += child.size;
  }
  return children;
}

function child(bytes: Uint8Array, parent: BoxRef, type: string) {
  return childBoxes(bytes, parent).find((candidate) => candidate.type === type) ?? null;
}

async function readBounded(reader: RangeReader, start: number, length: number) {
  if (length < 0 || length > MAX_MOOV_BYTES || start < 0 || start + length > reader.size) {
    throw new Error("MP4 metadata exceeded read limit.");
  }
  const output = new Uint8Array(length);
  for (let copied = 0; copied < length; copied += RANGE_BYTES) {
    const chunkLength = Math.min(RANGE_BYTES, length - copied);
    const chunk = await reader.read(start + copied, start + copied + chunkLength - 1);
    if (chunk.byteLength !== chunkLength) throw new Error("Invalid MP4 bounded range response.");
    output.set(chunk, copied);
  }
  return output;
}

async function findMoov(reader: RangeReader) {
  let offset = 0;
  for (let count = 0; offset + 8 <= reader.size && count < MAX_TOP_LEVEL_BOXES; count += 1) {
    const header = await reader.read(offset, Math.min(reader.size - 1, offset + 15));
    if (header.byteLength < 8) throw new Error("Invalid MP4 top-level box.");
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const size32 = u32(view, 0);
    const headerSize = size32 === 1 ? 16 : 8;
    if (header.byteLength < headerSize) throw new Error("Invalid MP4 top-level box.");
    const size = size32 === 0 ? reader.size - offset : size32 === 1 ? u64(view, 8) : size32;
    const type = ascii(header.subarray(4, 8));
    if (size < headerSize || offset + size > reader.size) throw new Error("Invalid MP4 top-level box size.");
    if (type === "moov") return { start: offset, size };
    offset += size;
  }
  throw new Error("MP4 moov box not found within read limit.");
}

function durationFromMoov(moov: Uint8Array, moovBox: BoxRef) {
  const mvhd = child(moov, moovBox, "mvhd");
  if (!mvhd) return null;
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const version = moov[mvhd.start + mvhd.headerSize];
  const base = mvhd.start + mvhd.headerSize + 4;
  const timescale = version === 1 ? u32(view, base + 16) : u32(view, base + 8);
  const duration = version === 1 ? u64(view, base + 20) : u32(view, base + 12);
  return timescale > 0 && duration > 0 ? Math.round((duration / timescale) * 1000) : null;
}

function isGpmdTrack(moov: Uint8Array, track: BoxRef) {
  const mdia = child(moov, track, "mdia");
  const minf = mdia && child(moov, mdia, "minf");
  const stbl = minf && child(moov, minf, "stbl");
  const stsd = stbl && child(moov, stbl, "stsd");
  if (!stsd) return false;
  const entryStart = stsd.start + stsd.headerSize + 8;
  return boxAt(moov, entryStart, stsd.start + stsd.size)?.type === "gpmd";
}

function tableForGpmdTrack(moov: Uint8Array, moovBox: BoxRef) {
  const track = childBoxes(moov, moovBox).find(
    (candidate) => candidate.type === "trak" && isGpmdTrack(moov, candidate),
  );
  const mdia = track && child(moov, track, "mdia");
  const minf = mdia && child(moov, mdia, "minf");
  const stbl = minf && child(moov, minf, "stbl");
  if (!stbl) return null;
  const offsets = child(moov, stbl, "co64") ?? child(moov, stbl, "stco");
  const stsc = child(moov, stbl, "stsc");
  const stsz = child(moov, stbl, "stsz");
  return offsets && stsc && stsz ? { offsets, stsc, stsz } : null;
}

function sampleRanges(moov: Uint8Array, moovBox: BoxRef) {
  const tables = tableForGpmdTrack(moov, moovBox);
  if (!tables) return [];
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const offsetCount = u32(view, tables.offsets.start + tables.offsets.headerSize + 4);
  const offsetWidth = tables.offsets.type === "co64" ? 8 : 4;
  const offsetsStart = tables.offsets.start + tables.offsets.headerSize + 8;
  const stscCount = u32(view, tables.stsc.start + tables.stsc.headerSize + 4);
  const stscStart = tables.stsc.start + tables.stsc.headerSize + 8;
  const fixedSize = u32(view, tables.stsz.start + tables.stsz.headerSize + 4);
  const sampleCount = u32(view, tables.stsz.start + tables.stsz.headerSize + 8);
  const sizesStart = tables.stsz.start + tables.stsz.headerSize + 12;
  const ranges: Array<{ start: number; size: number }> = [];
  let sampleIndex = 0;
  let totalBytes = 0;

  for (let chunkIndex = 1; chunkIndex <= offsetCount && sampleIndex < sampleCount; chunkIndex += 1) {
    let samplesPerChunk = 0;
    for (let entry = 0; entry < stscCount; entry += 1) {
      const entryOffset = stscStart + entry * 12;
      if (u32(view, entryOffset) > chunkIndex) break;
      samplesPerChunk = u32(view, entryOffset + 4);
    }
    if (!samplesPerChunk) throw new Error("Invalid MP4 telemetry sample table.");
    const chunkOffset = offsetWidth === 8
      ? u64(view, offsetsStart + (chunkIndex - 1) * offsetWidth)
      : u32(view, offsetsStart + (chunkIndex - 1) * offsetWidth);
    let withinChunk = 0;
    for (let sample = 0; sample < samplesPerChunk && sampleIndex < sampleCount; sample += 1) {
      const size = fixedSize || u32(view, sizesStart + sampleIndex * 4);
      if (ranges.length < MAX_TELEMETRY_SAMPLES && totalBytes + size <= MAX_TELEMETRY_BYTES) {
        ranges.push({ start: chunkOffset + withinChunk, size });
        totalBytes += size;
      }
      withinChunk += size;
      sampleIndex += 1;
    }
    if (ranges.length >= MAX_TELEMETRY_SAMPLES || totalBytes >= MAX_TELEMETRY_BYTES) break;
  }
  return ranges;
}

function gpsuToUtcMs(value: string) {
  if (!/^\d{12}\.\d{3}$/.test(value)) throw new Error("Invalid GPSU timestamp.");
  const utc = Date.UTC(
    Number(`20${value.slice(0, 2)}`),
    Number(value.slice(2, 4)) - 1,
    Number(value.slice(4, 6)),
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(13, 16)),
  );
  if (!Number.isFinite(utc)) throw new Error("Invalid GPSU timestamp.");
  return utc;
}

function findGpsu(bytes: Uint8Array, start = 0, end = bytes.byteLength, depth = 0): string | null {
  if (depth > 8) return null;
  let cursor = start;
  while (cursor + 8 <= end) {
    const key = ascii(bytes.subarray(cursor, cursor + 4));
    const type = bytes[cursor + 4];
    const structureSize = bytes[cursor + 5];
    const repeat = (bytes[cursor + 6] << 8) | bytes[cursor + 7];
    const dataSize = structureSize * repeat;
    const dataStart = cursor + 8;
    const dataEnd = dataStart + dataSize;
    if (!structureSize || dataEnd > end) return null;
    if (key === "GPSU" && type === "U".charCodeAt(0)) {
      return ascii(bytes.subarray(dataStart, dataEnd)).replace(/\0+$/, "");
    }
    if (type === 0) {
      const nested = findGpsu(bytes, dataStart, dataEnd, depth + 1);
      if (nested) return nested;
    }
    cursor = dataStart + Math.ceil(dataSize / 4) * 4;
  }
  return null;
}

export async function extractVideoTiming(reader: RangeReader): Promise<VideoExtractionResult> {
  try {
    if (reader.size < 32) throw new Error("Invalid MP4 media.");
    const moovRef = await findMoov(reader);
    const moov = await readBounded(reader, moovRef.start, moovRef.size);
    const moovBox = boxAt(moov, 0);
    if (!moovBox || moovBox.type !== "moov") throw new Error("Invalid MP4 moov box.");
    const durationMs = durationFromMoov(moov, moovBox);
    const ranges = sampleRanges(moov, moovBox);
    if (!ranges.length) {
      return {
        ok: false,
        failure: { code: "unsupported_telemetry", message: "No supported GoPro timing telemetry was found." },
        summary: { parser: "bounded-gpmf-gpsu-v2", sample_ranges_read: 0 },
      };
    }
    for (const range of ranges) {
      const sample = await readBounded(reader, range.start, range.size);
      const gpsu = findGpsu(sample);
      if (gpsu && durationMs) {
        const startUtcMs = gpsuToUtcMs(gpsu);
        return {
          ok: true,
          timing: { startUtcMs, durationMs, provenance: "telemetry", parser: "bounded-gpmf-gpsu-v2" },
          summary: {
            parser: "bounded-gpmf-gpsu-v2",
            bounded: true,
            moov_bytes: moovRef.size,
            sample_ranges_read: ranges.indexOf(range) + 1,
          },
        };
      }
    }
    return {
      ok: false,
      failure: { code: "unsupported_telemetry", message: "No supported GoPro timing telemetry was found." },
      summary: { parser: "bounded-gpmf-gpsu-v2", sample_ranges_read: ranges.length },
    };
  } catch (error) {
    return { ok: false, failure: sanitizeVideoProcessingError(error), summary: { parser: "bounded-gpmf-gpsu-v2" } };
  }
}
