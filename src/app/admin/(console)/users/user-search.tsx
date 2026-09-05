"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search } from "lucide-react";

/**
 * Finding one person among all of them.
 *
 * The page has always read `?q=`, but nothing on it could set the parameter —
 * so in practice staff could only scroll the sixty most recent accounts and
 * hope. It searches the display name and the address; the address is what a
 * support message actually arrives with, and the column beside it is masked.
 */
export function UserSearch({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(current);

  const submit = (value: string) => {
    const trimmed = value.trim();
    startTransition(() =>
      router.push(trimmed ? `/admin/users?q=${encodeURIComponent(trimmed)}` : "/admin/users"),
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(query);
      }}
      className="relative w-full sm:w-72"
    >
      {pending ? (
        <LoaderCircle
          className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted animate-spin"
          aria-hidden
        />
      ) : (
        <Search
          className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none"
          aria-hidden
          strokeWidth={1.75}
        />
      )}

      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // A cleared box should bring the full list back without a submit.
          if (event.target.value === "") submit("");
        }}
        placeholder="ابحث باسم أو بريد"
        aria-label="ابحث عن مستخدم باسم أو بريد"
        className="w-full h-9 ps-9 pe-3 rounded-sm border border-border-strong bg-surface text-meta"
      />
    </form>
  );
}
