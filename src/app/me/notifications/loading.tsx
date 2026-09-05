export default function NotificationsLoading() {
  return (
    <div className="w-full mx-auto max-w-2xl px-4 py-5 pb-24 sm:pb-10">
      <div className="skeleton h-8 w-28 rounded-sm mb-4" />
      <div className="rounded-md border border-border divide-y divide-border">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 px-4 py-3.5">
            <div className="skeleton size-2 rounded-full mt-1.5" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-40 rounded-sm" />
              <div className="skeleton h-3 w-24 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
