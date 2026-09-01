"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ar } from "@/i18n/ar";

/**
 * Modal surfaces built on the native <dialog> element.
 *
 * `showModal()` gives focus trapping, Escape-to-close, inert background content
 * and the top layer for free — all the things a hand-rolled overlay gets wrong.
 * `variant="sheet"` docks it to the bottom of the screen, which is where a
 * one-handed user's thumb already is.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "sheet",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "sheet" | "dialog";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Fires for Escape as well as our own close(), so the parent's state stays
    // in step with the element either way.
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself, not its content).
        if (event.target === ref.current) ref.current?.close();
      }}
      className={cn(
        "bg-transparent p-0 max-w-none max-h-none backdrop:bg-ink/45",
        variant === "sheet"
          ? "sheet w-full m-0 mt-auto sm:m-auto sm:max-w-lg sm:w-[calc(100%-2rem)]"
          : "m-auto w-[calc(100%-2rem)] max-w-lg",
      )}
    >
      <div
        className={cn(
          "bg-surface text-text border border-border shadow-overlay",
          "flex flex-col max-h-[85vh]",
          variant === "sheet" ? "rounded-t-lg sm:rounded-lg" : "rounded-lg",
        )}
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-h2 text-text-strong">{title}</h2>
            {description && <p className="mt-1 text-meta text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label={ar.common.close}
            className="shrink-0 -me-1.5 -mt-0.5 size-9 grid place-items-center rounded-sm text-muted hover:text-text hover:bg-surface-sunken transition-colors"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="px-5 py-4 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <footer className="px-5 py-3 border-t border-border bg-surface-sunken/50 rounded-b-lg">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
