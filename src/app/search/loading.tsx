import { ReportListSkeleton } from "@/components/ui/states";

/**
 * Shown while the search query runs.
 *
 * On the connections this product is actually used on, a page transition
 * without this is several seconds of the previous screen sitting there looking
 * broken. A skeleton is not decoration — it is the difference between "it is
 * working" and "it is stuck".
 */
export default function SearchLoading() {
  return (
    <div className="w-full mx-auto max-w-5xl px-4 py-5 pb-24 sm:pb-10">
      <div className="skeleton h-8 w-40 rounded-sm mb-4" />
      <div className="skeleton h-11 w-full rounded-md mb-5" />
      <ReportListSkeleton count={5} />
    </div>
  );
}
