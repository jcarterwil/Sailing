export const CREATE_NEW_BOAT_VALUE = "__create_new_boat__";

export interface FleetMappingDraft {
  key: string;
  filename: string;
  suggestedName: string;
  target: string;
  newBoatName: string;
}

interface FileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export function boatNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.replace(/[\s_-]*\d{1,2}-\d{1,2}-\d{4}\s*$/, "").trim() || stem;
}

/** File selection only creates client-side drafts; durable identity is blank. */
export function buildFleetMappingDrafts(files: FileIdentity[]): FleetMappingDraft[] {
  return files.map((file, index) => {
    const suggestedName = boatNameFromFilename(file.name);
    return {
      key: `${file.name}:${file.size}:${file.lastModified}:${index}`,
      filename: file.name,
      suggestedName,
      target: "",
      newBoatName: suggestedName,
    };
  });
}

export function fleetMappingErrors(drafts: FleetMappingDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const existingTargets = new Map<string, string>();

  for (const draft of drafts) {
    if (!draft.target) {
      errors[draft.key] = "Choose an existing boat or explicitly create a new one.";
      continue;
    }
    if (draft.target === CREATE_NEW_BOAT_VALUE) {
      if (!draft.newBoatName.trim()) errors[draft.key] = "Enter a name for the new boat.";
      continue;
    }

    const firstKey = existingTargets.get(draft.target);
    if (firstKey) {
      errors[firstKey] = "The same boat cannot be mapped to two files in one race.";
      errors[draft.key] = "The same boat cannot be mapped to two files in one race.";
    } else {
      existingTargets.set(draft.target, draft.key);
    }
  }

  return errors;
}
