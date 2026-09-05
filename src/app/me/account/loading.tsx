export default function AccountLoading() {
  return (
    <div className="w-full mx-auto max-w-2xl px-4 py-5 pb-24 sm:pb-10">
      <div className="flex items-start gap-4 mb-6">
        <div className="skeleton size-20 rounded-full" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="skeleton h-6 w-40 rounded-sm" />
          <div className="skeleton h-3.5 w-28 rounded-sm" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="mb-4">
          <div className="skeleton h-3.5 w-24 rounded-sm mb-2" />
          <div className="skeleton h-24 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
