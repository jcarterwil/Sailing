export const HISTORICAL_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const HISTORICAL_IMPORT_MAX_FILES = 100;
export const HISTORICAL_IMPORT_MAX_BATCH_BYTES = 500 * 1024 * 1024;
export const HISTORICAL_IMPORT_MAX_SESSION_CANDIDATES = 10;
export const HISTORICAL_IMPORT_SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;
export const HISTORICAL_IMPORT_PROBABLE_OVERLAP = 0.95;
export const HISTORICAL_IMPORT_PROBABLE_POINT_TOLERANCE = 0.02;

export const HISTORICAL_IMPORT_EXTENSIONS = ["vkx", "csv"] as const;
export type HistoricalImportFormat = (typeof HISTORICAL_IMPORT_EXTENSIONS)[number];

export function extensionForFilename(filename: string): HistoricalImportFormat | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "vkx" || ext === "csv") return ext;
  return null;
}
