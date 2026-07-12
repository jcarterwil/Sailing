export type ReportStatus = "generating" | "complete" | "error";

export interface ReportSummary {
  id: string;
  status: ReportStatus;
  markdown: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ReportSnapshot {
  report: ReportSummary | null;
  latestComplete: ReportSummary | null;
}

export const REPORT_SUMMARY_COLUMNS =
  "id, status, markdown, model, input_tokens, output_tokens, error_message, created_at, completed_at" as const;
export const REPORT_STATUS_COLUMNS =
  "id, status, model, input_tokens, output_tokens, error_message, created_at, completed_at" as const;

interface ReportRow {
  id: string;
  status: string;
  markdown?: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export function toReportSummary(row: ReportRow): ReportSummary {
  if (row.status !== "generating" && row.status !== "complete" && row.status !== "error") {
    throw new Error(`Unknown report status: ${row.status}`);
  }
  return {
    id: row.id,
    status: row.status,
    markdown: row.markdown ?? null,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
