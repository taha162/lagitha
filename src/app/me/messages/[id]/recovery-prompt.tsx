"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { confirmRecoveryAction } from "@/app/actions/messaging";

/**
 * Both sides confirm the handover independently. Until both have, nothing is
 * marked recovered — the number this produces is the one the whole project is
 * judged by, so it has to mean an item actually changed hands.
 */
export function RecoveryPrompt({
  recoveryId,
  alreadyConfirmed,
  isOwner,
}: {
  recoveryId: string;
  alreadyConfirmed: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const result = await confirmRecoveryAction(recoveryId);
    setBusy(false);

    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(result.data.completed ? ar.recovery.done : ar.recovery.waitingOther, "success");
    router.refresh();
  }

  return (
    <section className="mb-4 rounded-md border border-success/30 bg-success-soft px-4 py-3">
      <h2 className="flex items-center gap-2 text-meta font-medium text-success">
        <PackageCheck className="size-4.5" aria-hidden strokeWidth={1.75} />
        {ar.recovery.title}
      </h2>

      {alreadyConfirmed ? (
        <p className="mt-1.5 text-fine text-muted">{ar.recovery.waitingOther}</p>
      ) : (
        <>
          <p className="mt-1 text-meta text-text">{ar.recovery.question}</p>
          <Button size="sm" className="mt-2.5" onClick={confirm} disabled={busy}>
            <CheckCircle2 className="size-4" aria-hidden strokeWidth={1.75} />
            {isOwner ? ar.recovery.ownerConfirm : ar.recovery.finderConfirm}
          </Button>
        </>
      )}
    </section>
  );
}
