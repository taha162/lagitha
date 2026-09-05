import { ReportListSkeleton } from "@/components/ui/states";

export default function MyReportsLoading() {
  return (
    <div className="w-full mx-auto max-w-2xl px-4 py-5 pb-24 sm:pb-10">
      <div className="skeleton h-8 w-32 rounded-sm mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="skeleton h-9 w-20 rounded-sm" />
        <div className="skeleton h-9 w-20 rounded-sm" />
        <div className="skeleton h-9 w-20 rounded-sm" />
      </div>
      <ReportListSkeleton count={3} />
    </div>
  );
}
