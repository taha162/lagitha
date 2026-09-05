"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/app/actions/auth";

/**
 * The one irreversible control in the console.
 *
 * Everything else a moderator does can be undone — hide, unhide, suspend,
 * reopen. This cannot, so it is built to be hard to reach by accident: a
 * native `<dialog>` (focus trapped, Escape closes), the exact reference or
 * name typed back, a written reason, and a submit button that stays disabled
 * until both are right. The reminder that hiding is usually enough sits above
 * the button, where somebody about to press it will read it.
 */
export function DeleteDialog({
  label,
  title,
  body,
  confirmWord,
  onDelete,
  onDeleted,
}: {
  /** Button text in the surrounding table or drawer. */
  label: string;
  title: string;
  body: string;
  /** What has to be typed back — a report reference, or an account's name. */
  confirmWord: string;
  onDelete: (input: { confirm: string; reason: string }) => Promise<ActionResult>;
  /** Where to go once the row is gone; the caller decides. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = confirm.trim() === confirmWord && reason.trim().length >= 4;

  // Clearing on close means a reopened dialog never starts half-armed.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const reset = () => {
      setConfirm("");
      setReason("");
    };
    dialog.addEventListener("close", reset);
    return () => dialog.removeEventListener("close", reset);
  }, []);

  async function run() {
    setBusy(true);
    const result = await onDelete({ confirm: confirm.trim(), reason: reason.trim() });
    setBusy(false);

    if (!result.ok) {
      toast(result.error, "error");
      return;
    }

    dialogRef.current?.close();
    toast(ar.admin.actions.deleted, "success");
    onDeleted?.();
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger hover:bg-danger-soft"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Trash2 className="size-3.5" aria-hidden />
        {label}
      </Button>

      <dialog
        ref={dialogRef}
        className="w-[min(30rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-0 text-text backdrop:bg-ink/50 backdrop:backdrop-blur-sm"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-danger-soft text-danger">
              <AlertTriangle className="size-4.5" aria-hidden />
            </span>
            <div className="space-y-1">
              <h2 className="text-h3 text-text-strong">{title}</h2>
              <p className="text-meta text-muted leading-relaxed">{body}</p>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-meta font-medium text-text">
              {ar.admin.actions.deleteTypeToConfirm(confirmWord)}
            </span>
            <input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="w-full h-11 rounded-md border border-border-strong bg-surface px-3 text-body"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-meta font-medium text-text">
              {ar.admin.actions.reasonLabel}
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder={ar.admin.actions.reasonRequired}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-meta placeholder:text-muted"
            />
          </label>

          <p className="flex items-center gap-1.5 text-fine text-warning">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {ar.admin.actions.preferHide}
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dialogRef.current?.close()}
              disabled={busy}
            >
              {ar.common.cancel}
            </Button>
            <Button variant="danger" size="sm" onClick={run} disabled={!ready || busy}>
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {ar.common.loading}
                </>
              ) : (
                ar.admin.actions.delete
              )}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
