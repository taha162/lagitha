"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { decideIdentityAction } from "@/app/actions/identity";

/**
 * The reviewer's controls for one card.
 *
 * The images open in a new tab rather than rendering inline. That is
 * deliberate: an identity document should not sit on screen behind a queue the
 * reviewer is scrolling, and the deliberate click is what the audit entry
 * records.
 *
 * Rejecting requires a written reason because the reason is sent to the person
 * — "rejected" with no explanation leaves them with nothing to fix.
 */
export function IdentityReview({ verificationId }: { verificationId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  async function decide(decision: "APPROVED" | "REJECTED") {
    const formData = new FormData();
    formData.set("verificationId", verificationId);
    formData.set("decision", decision);
    if (note) formData.set("note", note);

    setBusy(true);
    const result = await decideIdentityAction(undefined, formData);
    setBusy(false);

    toast(result.ok ? ar.identity.decided : result.error, result.ok ? "success" : "error");
    if (result.ok) {
      setRejecting(false);
      setNote("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary">
          <a href={`/api/identity/${verificationId}/front`} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden />
            {ar.identity.adminOpenFront}
          </a>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <a href={`/api/identity/${verificationId}/back`} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" aria-hidden />
            {ar.identity.adminOpenBack}
          </a>
        </Button>
      </div>

      <p className="text-fine text-muted">{ar.identity.adminViewNotice}</p>

      {rejecting ? (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={300}
            placeholder={ar.identity.rejectReasonRequired}
            className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-meta text-text placeholder:text-muted"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="danger"
              onClick={() => decide("REJECTED")}
              disabled={busy || note.trim().length === 0}
            >
              {ar.identity.adminReject}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
              {ar.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => decide("APPROVED")} disabled={busy}>
            {ar.identity.adminApprove}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(true)} disabled={busy}>
            {ar.identity.adminReject}
          </Button>
        </div>
      )}
    </div>
  );
}
