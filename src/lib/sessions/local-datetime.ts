import { isValidIanaTimezone, normalizeIanaTimezone } from "@/lib/races/meta";

export interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

export type LocalToUtcFailureReason =
  | "invalid-timezone"
  | "invalid-local"
  | "nonexistent"
  | "ambiguous";

export type LocalToUtcResult =
  | { ok: true; utc: Date; iso: string }
  | { ok: false; reason: LocalToUtcFailureReason };

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function asWallParts(parts: LocalDateTimeParts): WallParts | null {
  const second = parts.second ?? 0;
  if (
    !Number.isInteger(parts.year) ||
    !Number.isInteger(parts.month) ||
    !Number.isInteger(parts.day) ||
    !Number.isInteger(parts.hour) ||
    !Number.isInteger(parts.minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  // Reject impossible calendar dates (e.g. Feb 30) via UTC round-trip.
  const probe = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, second);
  const probeDate = new Date(probe);
  if (
    probeDate.getUTCFullYear() !== parts.year ||
    probeDate.getUTCMonth() !== parts.month - 1 ||
    probeDate.getUTCDate() !== parts.day ||
    probeDate.getUTCHours() !== parts.hour ||
    probeDate.getUTCMinutes() !== parts.minute ||
    probeDate.getUTCSeconds() !== second
  ) {
    return null;
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second,
  };
}

function wallPartsEqual(a: WallParts, b: WallParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function zonedWallParts(date: Date, timeZone: string): WallParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  let hour = Number(values.hour);
  // Some engines emit "24" for midnight.
  if (hour === 24) hour = 0;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const wall = zonedWallParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - utcMs;
}

/**
 * Convert an explicit local civil time in `timeZone` to a unique UTC instant.
 * Rejects nonexistent (DST spring-forward gaps) and ambiguous (fall-back folds)
 * local times instead of guessing.
 */
export function localDateTimeToUtc(
  parts: LocalDateTimeParts,
  timeZone: string,
): LocalToUtcResult {
  const normalizedZone = normalizeIanaTimezone(timeZone);
  if (!normalizedZone || !isValidIanaTimezone(normalizedZone)) {
    return { ok: false, reason: "invalid-timezone" };
  }

  const wall = asWallParts(parts);
  if (!wall) return { ok: false, reason: "invalid-local" };

  const wantedAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  // Two-pass offset correction finds the unique mapping when one exists.
  const guess1 = wantedAsUtc - getTimeZoneOffsetMs(wantedAsUtc, normalizedZone);
  const guess2 = wantedAsUtc - getTimeZoneOffsetMs(guess1, normalizedZone);

  const matches: number[] = [];
  // Search a ±2h window at 15-minute steps so 30-minute DST folds
  // (e.g. Australia/Lord_Howe) are detected as ambiguous.
  for (let deltaMinutes = -120; deltaMinutes <= 120; deltaMinutes += 15) {
    const candidate = guess2 + deltaMinutes * 60 * 1000;
    if (wallPartsEqual(zonedWallParts(new Date(candidate), normalizedZone), wall)) {
      if (!matches.includes(candidate)) matches.push(candidate);
    }
  }

  // Also accept the exact guess2 when the hour loop skipped due to odd offsets.
  if (
    wallPartsEqual(zonedWallParts(new Date(guess2), normalizedZone), wall) &&
    !matches.includes(guess2)
  ) {
    matches.push(guess2);
  }

  if (matches.length === 0) return { ok: false, reason: "nonexistent" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };

  const utc = new Date(matches[0]!);
  return { ok: true, utc, iso: utc.toISOString() };
}

/** Parse `YYYY-MM-DD` + `HH:mm` (24h) form values from `<input type="date|time">`. */
export function parseLocalDateAndTime(
  dateValue: string,
  timeValue: string,
): LocalDateTimeParts | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeValue.trim());
  if (!dateMatch || !timeMatch) return null;
  return {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: timeMatch[3] ? Number(timeMatch[3]) : 0,
  };
}

export function localToUtcErrorMessage(reason: LocalToUtcFailureReason): string {
  switch (reason) {
    case "invalid-timezone":
      return "Choose a valid IANA timezone, such as America/Detroit.";
    case "invalid-local":
      return "Enter a valid local date and time.";
    case "nonexistent":
      return "That local time does not exist in the selected timezone (DST gap).";
    case "ambiguous":
      return "That local time is ambiguous in the selected timezone (DST overlap). Pick a time outside the fold.";
  }
}
