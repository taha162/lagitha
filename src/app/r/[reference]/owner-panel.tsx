"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, KeyRound, LoaderCircle, X } from "lucide-react";
import { ar } from "@/i18n/ar";
import { relativeTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { TextAreaField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { setReportStatusAction, updateReportAction } from "@/app/actions/reports";
import {
  commitSecretAction,
  decideVerificationAction,
  revealAnswerAction,
} from "@/app/actions/verification";
import { confirmRecoveryAction } from "@/app/actions/messaging";

/**
 * The author's control panel on their own report.
 *
 * The verification section is where the fairness rule is enforced in the UI:
 * the claimant's answer is simply not on the page until the finder has
 * submitted their own expected detail — the server refuses to send it.
 */
interface Claim {
  id: string;
  status: "AWAITING_FINDER_SECRET" | "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  claimantName: string;
  claimantSince: string;
  createdAt: string;
}

export function OwnerPanel({
  reference,
  status,
  hasSecret,
  viewCount,
  claims,
  recoveryId,
  recoveryConfirmed,
}: {
  reference: string;
  status: "ACTIVE" | "RECOVERED" | "CLOSED";
  hasSecret: boolean;
  viewCount: number;
  claims: Claim[];
  recoveryId: string | null;
  recoveryConfirmed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [secretOpen, setSecretOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openClaims = claims.filter(
    (claim) => claim.status === "PENDING" || claim.status === "AWAITING_FINDER_SECRET",
  );

  async function changeStatus(next: "ACTIVE" | "CLOSED") {
    setBusy(true);
    const result = await setReportStatusAction({ reference, status: next });
    setBusy(false);
    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  async function confirm() {
    if (!recoveryId) return;
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
    <section className="rounded-md border border-border bg-surface divide-y divide-border">
      <header className="px-4 py-3 flex items-center justify-between gap-3">
        <h2 className="text-h3 text-text-strong">{ar.report.byYou}</h2>
        <span className="flex items-center gap-1.5 text-fine text-muted">
          <Eye className="size-3.5" aria-hidden strokeWidth={1.75} />
          <span className="latin tabular-nums">{viewCount}</span>
        </span>
      </header>

      {/* Verification claims waiting on the author. */}
      {openClaims.length > 0 && (
        <div className="px-4 py-3 space-y-2.5">
          <h3 className="text-meta font-medium text-text">
            {ar.myReports.claimsBadge(openClaims.length)}
          </h3>
          {openClaims.map((claim) => (
            <ClaimRow key={claim.id} claim={claim} onDone={() => router.refresh()} />
          ))}
        </div>
      )}

      {/* The private detail used to test a claim. */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta font-medium text-text flex items-center gap-1.5">
            <KeyRound className="size-4 text-muted" aria-hidden strokeWidth={1.75} />
            {ar.wizard.secretTitle}
          </p>
          <p className="mt-0.5 text-fine text-muted">
            {hasSecret ? ar.verification.finderSecretNote : ar.wizard.secretHint}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setSecretOpen(true)}>
          {hasSecret ? ar.report.edit : ar.common.save}
        </Button>
      </div>

      {/* Two-sided recovery confirmation. */}
      {recoveryId && status !== "RECOVERED" && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-meta font-medium text-text">{ar.recovery.question}</p>
          {recoveryConfirmed ? (
            <p className="text-fine text-muted">{ar.recovery.waitingOther}</p>
          ) : (
            <Button size="sm" onClick={confirm} disabled={busy}>
              <CheckCircle2 className="size-4" aria-hidden strokeWidth={1.75} />
              {ar.recovery.ownerConfirm}
            </Button>
          )}
        </div>
      )}

      {status === "RECOVERED" && (
        <div className="px-4 py-3">
          <p className="flex items-center gap-2 text-meta text-success">
            <CheckCircle2 className="size-4" aria-hidden strokeWidth={1.75} />
            {ar.recovery.done}
          </p>
          <p className="mt-0.5 text-fine text-muted">{ar.recovery.doneNote}</p>
        </div>
      )}

      {status !== "RECOVERED" && (
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {status === "ACTIVE" ? (
            <Button variant="ghost" size="sm" onClick={() => changeStatus("CLOSED")} disabled={busy}>
              <X className="size-4" aria-hidden strokeWidth={1.75} />
              {ar.report.close}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => changeStatus("ACTIVE")} disabled={busy}>
              {ar.report.reopen}
            </Button>
          )}
        </div>
      )}

      <SecretSheet
        open={secretOpen}
        onClose={() => setSecretOpen(false)}
        reference={reference}
        onSaved={() => router.refresh()}
      />
    </section>
  );
}

function ClaimRow({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState<{ answer: string; similarity: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openReview() {
    setOpen(true);
    setError(null);

    // If the secret is already committed the server will hand back the answer;
    // otherwise it refuses, and the sheet asks for the secret first.
    const result = await revealAnswerAction(claim.id);
    if (result.ok) {
      setRevealed({ answer: result.data.answer, similarity: result.data.similarity });
      setSecret(result.data.secret);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const result = await commitSecretAction({ requestId: claim.id, secret: secret.trim() });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRevealed({ answer: result.data.answer, similarity: result.data.similarity });
  }

  async function decide(decision: "ACCEPTED" | "REJECTED") {
    setBusy(true);
    const result = await decideVerificationAction({ requestId: claim.id, decision });
    setBusy(false);

    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(
      decision === "ACCEPTED" ? ar.verification.accepted : ar.verification.rejected,
      decision === "ACCEPTED" ? "success" : "info",
    );
    setOpen(false);
    onDone();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-sm border border-border bg-surface-sunken/50">
        <div className="min-w-0">
          <p className="text-meta text-text truncate">{claim.claimantName}</p>
          <p className="text-fine text-muted">{relativeTime(claim.createdAt)}</p>
        </div>
        <Button size="sm" onClick={openReview} className="shrink-0">
          {ar.common.more}
        </Button>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={ar.verification.finderTitle}
        description={ar.verification.finderIntro}
        footer={
          revealed ? (
            <div className="flex gap-2">
              <Button block onClick={() => decide("ACCEPTED")} disabled={busy}>
                {ar.verification.accept}
              </Button>
              <Button block variant="secondary" onClick={() => decide("REJECTED")} disabled={busy}>
                {ar.verification.reject}
              </Button>
            </div>
          ) : (
            <Button block onClick={commit} disabled={busy || secret.trim().length < 3}>
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {ar.common.loading}
                </>
              ) : (
                ar.verification.finderSecretSave
              )}
            </Button>
          )
        }
      >
        <div className="space-y-4">
          {!revealed && (
            <p className="text-meta text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-2.5">
              {ar.verification.finderSecretRequired}
            </p>
          )}

          <TextAreaField
            label={ar.verification.finderYourSecret}
            hint={ar.verification.finderSecretNote}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            maxLength={200}
            rows={3}
            disabled={Boolean(revealed)}
            error={error ?? undefined}
          />

          {revealed && (
            <div className="space-y-2 enter-fade">
              <h3 className="text-meta font-medium text-text">
                {ar.verification.finderAnswerLabel}
              </h3>
              <p className="text-body text-text bg-surface-sunken border border-border rounded-md px-3 py-2.5 whitespace-pre-wrap">
                {revealed.answer}
              </p>
              <p className="text-fine text-muted">
                {/* Advisory only — the person decides, not the string comparison. */}
                {ar.match.scoreLabel(Math.round(revealed.similarity * 100))} — {ar.match.disclaimer}
              </p>
              <p className="text-fine text-muted">{ar.verification.decisionNote}</p>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

function SecretSheet({
  open,
  onClose,
  reference,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  reference: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await updateReportAction({ reference, verificationSecret: value.trim() });
    setBusy(false);

    toast(result.ok ? ar.account.saved : result.error, result.ok ? "success" : "error");
    if (result.ok) {
      onClose();
      onSaved();
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ar.wizard.secretTitle}
      description={ar.wizard.secretHint}
      footer={
        <Button block onClick={save} disabled={busy || value.trim().length < 3}>
          {ar.common.save}
        </Button>
      }
    >
      <TextAreaField
        label={ar.wizard.secretTitle}
        placeholder={ar.wizard.secretExample}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={200}
        rows={3}
        autoFocus
      />
    </Sheet>
  );
}
