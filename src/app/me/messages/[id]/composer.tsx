"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { containsPhoneNumber } from "@/lib/arabic";
import { sendMessageAction } from "@/app/actions/messaging";
import { cn } from "@/lib/utils";

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Warn as they type, but never block: a person may have a good reason, and
  // silently rewriting someone's message would be worse than a nudge.
  const phoneWarning = containsPhoneNumber(body);

  async function send() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setSending(true);
    setError(null);
    const result = await sendMessageAction({ conversationId, body: trimmed });
    setSending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 bg-surface border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-2xl px-4 py-3">
        {phoneWarning && (
          <p className="mb-2 text-fine text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-1.5">
            {ar.messages.phoneWarning}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-fine text-danger">
            {error}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor="composer" className="sr-only">
            {ar.messages.placeholder}
          </label>
          <textarea
            id="composer"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends on a physical keyboard; Shift+Enter is a newline.
              // On touch keyboards Enter inserts a newline as usual.
              if (event.key === "Enter" && !event.shiftKey && !("ontouchstart" in window)) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={1000}
            placeholder={ar.messages.placeholder}
            className={cn(
              "flex-1 min-h-11 max-h-32 px-3 py-2.5 resize-none",
              "rounded-md border border-border-strong bg-background text-body",
              "focus-visible:outline-2 focus-visible:outline-focus",
            )}
          />

          <button
            type="submit"
            disabled={sending || body.trim().length === 0}
            aria-label={ar.messages.send}
            className="shrink-0 size-11 grid place-items-center rounded-md bg-primary text-primary-contrast disabled:opacity-50 hover:bg-primary-hover transition-colors"
          >
            {sending ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden />
            ) : (
              // The icon points the way text flows in RTL.
              <Send className="size-5 -scale-x-100" aria-hidden strokeWidth={1.75} />
            )}
          </button>
        </form>
      </div>
    </footer>
  );
}
