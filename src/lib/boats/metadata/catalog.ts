import { CATALOG_BOUNDS, SAIL_TYPES, type SailType } from "@/lib/boats/metadata/types";

function trimRequired(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function trimOptional(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return trimRequired(value, max);
}

export function normalizeCrewPersonInput(input: {
  displayName: unknown;
  defaultRole?: unknown;
  notes?: unknown;
}): { displayName: string; defaultRole: string | null; notes: string | null } | null {
  const displayName = trimRequired(input.displayName, CATALOG_BOUNDS.displayName);
  if (!displayName) return null;
  return {
    displayName,
    defaultRole: trimOptional(input.defaultRole, CATALOG_BOUNDS.defaultRole),
    notes: trimOptional(input.notes, CATALOG_BOUNDS.notes),
  };
}

export function normalizeSailInput(input: {
  label: unknown;
  sailType?: unknown;
  notes?: unknown;
}): { label: string; sailType: SailType | null; notes: string | null } | null {
  const label = trimRequired(input.label, CATALOG_BOUNDS.sailLabel);
  if (!label) return null;
  let sailType: SailType | null = null;
  if (typeof input.sailType === "string" && input.sailType.trim()) {
    const candidate = input.sailType.trim().toLowerCase();
    if (!(SAIL_TYPES as readonly string[]).includes(candidate)) return null;
    sailType = candidate as SailType;
  }
  return {
    label,
    sailType,
    notes: trimOptional(input.notes, CATALOG_BOUNDS.notes),
  };
}

export function normalizeSetupInput(input: {
  name: unknown;
  notes?: unknown;
  fields?: unknown;
}): {
  name: string;
  notes: string | null;
  fields: Record<string, string>;
} | null {
  const name = trimRequired(input.name, CATALOG_BOUNDS.setupName);
  if (!name) return null;
  const fields: Record<string, string> = {};
  if (input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)) {
    for (const [rawKey, rawValue] of Object.entries(
      input.fields as Record<string, unknown>,
    )) {
      if (Object.keys(fields).length >= CATALOG_BOUNDS.maxSetupFields) break;
      const key = trimRequired(rawKey, CATALOG_BOUNDS.setupFieldKey);
      const value = trimRequired(rawValue, CATALOG_BOUNDS.setupFieldValue);
      if (!key || !value) continue;
      fields[key] = value;
    }
  }
  return {
    name,
    notes: trimOptional(input.notes, CATALOG_BOUNDS.notes),
    fields,
  };
}

export function normalizeSessionTagDefInput(input: {
  label: unknown;
}): { label: string } | null {
  const label = trimRequired(input.label, CATALOG_BOUNDS.tagLabel);
  if (!label) return null;
  return { label };
}
