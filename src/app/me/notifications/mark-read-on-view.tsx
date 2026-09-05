"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markNotificationsReadAction } from "@/app/actions/messaging";

/**
 * Clears the unread badge because the person opened the list.
 *
 * Having to press "mark all read" after already reading them is busywork: the
 * badge exists to say "there is something new", and opening the page answers
 * it. The button stays for marking a list read without going through it.
 *
 * This runs from the client rather than during the server render, and that is
 * the point: the router prefetches pages on hover and on viewport entry, so a
 * write during render would clear the badge for someone who merely scrolled
 * past the link. An effect only fires when the page is actually shown.
 *
 * The rows themselves keep the highlight they were rendered with, so the
 * person can still see which ones were new — the refresh happens without
 * repainting them as read underneath the reader.
 */
export function MarkReadOnView({ unread }: { unread: number }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (unread === 0 || done.current) return;
    done.current = true;

    void markNotificationsReadAction().then(() => {
      // Repaints the header badge and the bottom-bar dot. The list is already
      // on screen and does not change.
      router.refresh();
    });
  }, [unread, router]);

  return null;
}
