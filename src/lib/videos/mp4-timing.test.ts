import { describe, expect, it } from "vitest";

import { extractVideoTiming, type RangeReader } from "@/lib/videos/mp4-timing";
import { validateManualVideoTiming } from "@/lib/videos/timing";

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function numbers(...values: number[]) {
  const output = new Uint8Array(values.length * 4);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, false));
  return output;
}

function box(type: string, payload: Uint8Array) {
  const output = new Uint8Array(8 + payload.length);
  new DataView(output.buffer).setUint32(0, output.length, false);
  output.set(new TextEncoder().encode(type), 4);
  output.set(payload, 8);
  return output;
}

function fullBox(type: string, payload: Uint8Array) {
  return box(type, concat(new Uint8Array(4), payload));
}

function gpsuKlv(value = "260713123456.789") {
  const timestamp = new TextEncoder().encode(value);
  return concat(
    new TextEncoder().encode("GPSU"),
    new Uint8Array(["U".charCodeAt(0), timestamp.byteLength, 0, 1]),
    timestamp,
  );
}

function mvhd(durationMs: number) {
  return fullBox("mvhd", concat(numbers(0, 0, 1000, durationMs), new Uint8Array(80)));
}

function telemetryTrack(sampleOffset: number, sampleSize: number) {
  const stsd = fullBox("stsd", concat(numbers(1), box("gpmd", new Uint8Array())));
  const stsc = fullBox("stsc", concat(numbers(1), numbers(1, 1, 1)));
  const stsz = fullBox("stsz", numbers(sampleSize, 1));
  const stco = fullBox("stco", concat(numbers(1), numbers(sampleOffset)));
  return box("trak", box("mdia", box("minf", box("stbl", concat(stsd, stsc, stsz, stco)))));
}

function gpmfMp4({ telemetry = true, durationMs = 12345, mediaPadding = 0 } = {}) {
  const ftyp = box("ftyp", new TextEncoder().encode("isom"));
  const sample = telemetry ? gpsuKlv() : concat(new TextEncoder().encode("JUNK"), new Uint8Array(["B".charCodeAt(0), 4, 0, 1, 0, 0, 0, 0]));
  const mdatPayload = concat(new Uint8Array(mediaPadding), sample);
  const mdat = box("mdat", mdatPayload);
  const sampleOffset = ftyp.byteLength + 8 + mediaPadding;
  const moov = box("moov", concat(mvhd(durationMs), telemetryTrack(sampleOffset, sample.byteLength)));
  return concat(ftyp, mdat, moov);
}

function reader(bytes: Uint8Array): RangeReader & { ranges: Array<[number, number]> } {
  const ranges: Array<[number, number]> = [];
  return {
    size: bytes.length,
    ranges,
    async read(start, end) {
      ranges.push([start, end]);
      return bytes.slice(start, end + 1);
    },
  };
}

describe("bounded video timing extraction", () => {
  it("parses a real GPSU KLV header through the gpmd sample tables", async () => {
    const result = await extractVideoTiming(reader(gpmfMp4()));
    expect(result).toMatchObject({
      ok: true,
      timing: {
        startUtcMs: Date.parse("2026-07-13T12:34:56.789Z"),
        durationMs: 12345,
        provenance: "telemetry",
        parser: "bounded-gpmf-gpsu-v2",
      },
    });
  });

  it("jumps over a large mdat to find moov and reads the advertised telemetry sample", async () => {
    const source = reader(gpmfMp4({ mediaPadding: 2 * 1024 * 1024 }));
    const result = await extractVideoTiming(source);
    expect(result.ok).toBe(true);
    expect(source.ranges.some(([start]) => start >= 2 * 1024 * 1024)).toBe(true);
  });

  it("returns sanitized unsupported telemetry failures", async () => {
    const result = await extractVideoTiming(reader(gpmfMp4({ telemetry: false })));
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "unsupported_telemetry", message: "No supported GoPro timing telemetry was found." },
    });
  });

  it("returns sanitized corrupt-media failures", async () => {
    const result = await extractVideoTiming(reader(new TextEncoder().encode("not an mp4")));
    expect(result).toMatchObject({ ok: false, failure: { code: "invalid_media" } });
  });

  it("keeps every remote range bounded", async () => {
    const source = reader(gpmfMp4({ mediaPadding: 6 * 1024 * 1024 }));
    await extractVideoTiming(source);
    expect(source.ranges.every(([start, end]) => end - start + 1 <= 256 * 1024)).toBe(true);
  });
});

describe("manual video timing", () => {
  it("normalizes manual UTC alignment with provenance", () => {
    expect(
      validateManualVideoTiming({ startUtc: "2026-07-13T12:00:00.000Z", durationMs: 5000 }),
    ).toEqual({
      startUtcMs: Date.parse("2026-07-13T12:00:00.000Z"),
      durationMs: 5000,
      provenance: "manual",
      parser: "manual-v1",
    });
  });
});
