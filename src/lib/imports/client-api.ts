import type {
  HistoricalImportBatchPublic,
  HistoricalImportCommitResult,
  HistoricalImportItemPublic,
  HistoricalImportMapping,
  HistoricalImportUploadGrant,
} from "@/lib/imports/types";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // fall through
  }
  if (response.status === 401) return "Not signed in.";
  if (response.status === 403) return "Not allowed.";
  if (response.status === 404) return "Import batch not found.";
  return "Something went wrong. Please try again.";
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

export function historicalImportDraftKey(boatId: string): string {
  return `historical-import-draft:${boatId}`;
}

export function rememberHistoricalImportDraft(boatId: string, batchId: string) {
  try {
    window.localStorage.setItem(historicalImportDraftKey(boatId), batchId);
  } catch {
    // ignore quota / private mode
  }
}

export function readHistoricalImportDraft(boatId: string): string | null {
  try {
    return window.localStorage.getItem(historicalImportDraftKey(boatId));
  } catch {
    return null;
  }
}

export function clearHistoricalImportDraft(boatId: string) {
  try {
    window.localStorage.removeItem(historicalImportDraftKey(boatId));
  } catch {
    // ignore
  }
}

export async function createHistoricalImportBatch(
  boatId: string,
): Promise<HistoricalImportBatchPublic> {
  return apiFetch(`/api/boats/${boatId}/historical-imports`, { method: "POST" });
}

export async function fetchHistoricalImportBatch(
  boatId: string,
  batchId: string,
): Promise<HistoricalImportBatchPublic> {
  return apiFetch(`/api/boats/${boatId}/historical-imports/${batchId}`);
}

export async function cancelHistoricalImportBatch(
  boatId: string,
  batchId: string,
): Promise<void> {
  await apiFetch(`/api/boats/${boatId}/historical-imports/${batchId}`, {
    method: "DELETE",
  });
}

export async function addHistoricalImportItems(
  boatId: string,
  batchId: string,
  files: { filename: string; byteSize: number }[],
): Promise<HistoricalImportUploadGrant[]> {
  const body = await apiFetch<{ uploads: HistoricalImportUploadGrant[] }>(
    `/api/boats/${boatId}/historical-imports/${batchId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ files }),
    },
  );
  return body.uploads;
}

export async function inspectHistoricalImportItem(
  boatId: string,
  batchId: string,
  itemId: string,
): Promise<HistoricalImportItemPublic> {
  const response = await fetch(
    `/api/boats/${boatId}/historical-imports/${batchId}/items/${itemId}/inspect`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    item?: HistoricalImportItemPublic | null;
  };
  if (!response.ok) {
    if (json.item) {
      // Preserve server error status so Retry re-inspects the staged file.
      const err = new Error(json.error ?? "Could not inspect file.");
      (err as Error & { item?: HistoricalImportItemPublic }).item = json.item;
      throw err;
    }
    throw new Error(json.error ?? (await readError(response)));
  }
  if (!json.item) throw new Error("Could not inspect file.");
  return json.item;
}

export async function patchHistoricalImportItem(
  boatId: string,
  batchId: string,
  itemId: string,
  body: { skip: true } | { mapping: HistoricalImportMapping },
): Promise<HistoricalImportItemPublic> {
  const response = await fetch(
    `/api/boats/${boatId}/historical-imports/${batchId}/items/${itemId}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    item?: HistoricalImportItemPublic;
  };
  if (!response.ok) {
    if (json.item) {
      // Probable-duplicate / blocked mapping still returns the saved item.
      const err = new Error(json.error ?? "Could not save mapping.");
      (err as Error & { item?: HistoricalImportItemPublic }).item = json.item;
      throw err;
    }
    throw new Error(json.error ?? (await readError(response)));
  }
  if (!json.item) throw new Error("Could not save mapping.");
  return json.item;
}

export async function commitHistoricalImportBatch(
  boatId: string,
  batchId: string,
): Promise<HistoricalImportCommitResult[]> {
  const body = await apiFetch<{ results: HistoricalImportCommitResult[] }>(
    `/api/boats/${boatId}/historical-imports/${batchId}/commit`,
    { method: "POST" },
  );
  return body.results;
}

export async function processTrack(trackId: string): Promise<void> {
  await apiFetch(`/api/tracks/${trackId}/process`, { method: "POST" });
}
