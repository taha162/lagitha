/**
 * The console's queues are database-heavy, so the wait here is real. Showing
 * the shape of the table that is coming beats an empty panel.
 */
export default function ConsoleLoading() {
  return (
    <div className="space-y-5">
      <div className="skeleton h-8 w-48 rounded-sm" />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-20 rounded-md" />
        ))}
      </div>
      <div className="skeleton h-64 w-full rounded-md" />
    </div>
  );
}
