export default function SeriesReportLoading() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-7xl px-4 py-8 sm:px-10" aria-busy="true">
      <div role="status" aria-label="Loading series standings" className="animate-pulse space-y-8">
        <div className="space-y-3 border-b pb-6">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-9 w-72 max-w-full rounded bg-muted" />
          <div className="h-4 w-full max-w-xl rounded bg-muted" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-xl border bg-muted/50" />
          ))}
        </div>
        <div className="h-80 rounded-xl border bg-muted/50" />
        <span className="sr-only">Loading series standings…</span>
      </div>
    </main>
  );
}
