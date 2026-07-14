export default function SharedPerformanceLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 sm:px-8 lg:px-10" aria-busy="true">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Performance Overview V1</p>
      <h1 className="mt-2 text-2xl font-semibold">Loading shared performance…</h1>
      <div className="mt-8 grid gap-4 lg:grid-cols-3" role="status" aria-label="Loading shared performance report">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-xl border bg-card/60" />
        ))}
      </div>
    </main>
  );
}
