import { Skeleton } from "@/components/ui/skeleton";

export default function SharedSeriesReportLoading() {
  return (
    <main
      className="mx-auto min-h-screen w-full max-w-[96rem] space-y-8 px-4 py-6 sm:px-8 lg:px-10"
      aria-busy="true"
      aria-label="Loading shared series standings"
      role="status"
    >
      <Skeleton className="h-10 w-72 max-w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
      <Skeleton className="h-96 w-full" />
      <span className="sr-only">Loading shared series standings…</span>
    </main>
  );
}
