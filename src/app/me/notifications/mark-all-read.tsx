"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { markNotificationsReadAction } from "@/app/actions/messaging";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markNotificationsReadAction();
          router.refresh();
        })
      }
      className="text-meta text-primary hover:text-primary-hover transition-colors disabled:opacity-60"
    >
      {ar.notifications.markAllRead}
    </button>
  );
}
