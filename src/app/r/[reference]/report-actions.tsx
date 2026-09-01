"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flag, MessageSquare, ShieldCheck, Share2, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextAreaField } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { claimReportAction } from "@/app/actions/verification";
import { startConversationAction } from "@/app/actions/messaging";
import { flagReportAction } from "@/app/actions/reports";

/**
 * What a visitor can do about someone else's report: claim it, message the
 * author, flag it, share it.
 *
 * Note what is absent — there is no phone number and no "call" button. Contact
 * happens inside the platform, tied to this report.
 */
type ClaimStatus =
  | "AWAITING_FINDER_SECRET"
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED";

export function ReportActions({
  reference,
  reportType,
  signedIn,
  existingClaim,
  reportActive,
}: {
  reference: string;
  reportType: "LOST" | "FOUND";
  signedIn: boolean;
  existingClaim: { id: string; status: ClaimStatus } | null;
  reportActive: boolean;
}) {
  const [sheet, setSheet] = useState<"claim" | "message" | "flag" | null>(null);

  if (!signedIn) {
    return (
      <section className="rounded-md border border-border bg-surface p-4 space-y-3">
        <p className="text-meta text-muted">{ar.auth.required}</p>
        <Button asChild block size="lg">
          <Link href={`/login?next=${encodeURIComponent(`/r/${reference}`)}`}>
            {ar.nav.signIn}
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {existingClaim ? (
        <ClaimStatusPanel status={existingClaim.status} />
      ) : (
        reportActive && (
          <Button block size="lg" onClick={() => setSheet("claim")}>
            <ShieldCheck className="size-5" aria-hidden strokeWidth={1.75} />
            {reportType === "FOUND" ? ar.report.claimItem : ar.match.title}
          </Button>
        )
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" onClick={() => setSheet("message")}>
          <MessageSquare className="size-4" aria-hidden strokeWidth={1.75} />
          {ar.report.contactOwner}
        </Button>
        <ShareButton reference={reference} />
        <Button variant="ghost" onClick={() => setSheet("flag")}>
          <Flag className="size-4" aria-hidden strokeWidth={1.75} />
          {ar.report.flag}
        </Button>
      </div>

      {!existingClaim && reportActive && (
        <p className="text-fine text-muted">{ar.report.claimItemHint}</p>
      )}

      <ClaimSheet
        open={sheet === "claim"}
        onClose={() => setSheet(null)}
        reference={reference}
      />
      <MessageSheet
        open={sheet === "message"}
        onClose={() => setSheet(null)}
        reference={reference}
      />
      <FlagSheet open={sheet === "flag"} onClose={() => setSheet(null)} reference={reference} />
    </section>
  );
}

function ClaimStatusPanel({ status }: { status: ClaimStatus }) {
  const label = {
    AWAITING_FINDER_SECRET: ar.verification.awaitingSecret,
    PENDING: ar.verification.pending,
    ACCEPTED: ar.verification.accepted,
    REJECTED: ar.verification.rejected,
    CANCELLED: ar.verification.cancelled,
  }[status];

  const tone =
    status === "ACCEPTED" ? "success" : status === "REJECTED" ? "danger" : "warning";

  return (
    <div className="rounded-md border border-border bg-surface p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="text-meta text-muted">
        {status === "ACCEPTED" ? ar.verification.nextStep : ar.verification.submittedNote}
      </p>
      {status === "ACCEPTED" && (
        <Button asChild variant="secondary" size="sm">
          <Link href="/me/messages">{ar.messages.title}</Link>
        </Button>
      )}
    </div>
  );
}

function ClaimSheet({
  open,
  onClose,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  reference: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await claimReportAction({ reference, answer: answer.trim() });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(ar.verification.submitted, "success");
    setAnswer("");
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ar.verification.title}
      description={ar.verification.intro}
      footer={
        <Button block size="lg" onClick={submit} disabled={submitting || answer.trim().length < 5}>
          {submitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.verification.submitting}
            </>
          ) : (
            ar.verification.submit
          )}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-meta text-text">{ar.verification.questionFallback}</p>
        <TextAreaField
          label={ar.verification.answerLabel}
          hint={ar.verification.answerHint}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          maxLength={400}
          rows={4}
          error={error ?? undefined}
          autoFocus
        />
      </div>
    </Sheet>
  );
}

function MessageSheet({
  open,
  onClose,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  reference: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await startConversationAction({ reference, body: body.trim() });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
    router.push(`/me/messages/${result.data.conversationId}`);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ar.report.contactOwner}
      description={ar.messages.safetyNote}
      footer={
        <Button block size="lg" onClick={submit} disabled={submitting || body.trim().length < 2}>
          {submitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.messages.sending}
            </>
          ) : (
            ar.messages.send
          )}
        </Button>
      }
    >
      <TextAreaField
        label={ar.messages.placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={1000}
        rows={4}
        error={error ?? undefined}
        autoFocus
      />
    </Sheet>
  );
}

const FLAG_REASONS = Object.entries(ar.flag.reasons) as [
  keyof typeof ar.flag.reasons,
  string,
][];

function FlagSheet({
  open,
  onClose,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  reference: string;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<string>("SPAM");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    const result = await flagReportAction({ reference, reason, note: note.trim() || undefined });
    setSubmitting(false);

    toast(result.ok ? ar.flag.submitted : result.error, result.ok ? "success" : "error");
    if (result.ok) {
      setNote("");
      onClose();
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={ar.flag.title}
      description={ar.flag.intro}
      footer={
        <Button block variant="danger" onClick={submit} disabled={submitting}>
          {submitting ? ar.messages.sending : ar.flag.submit}
        </Button>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{ar.flag.intro}</legend>
        {FLAG_REASONS.map(([value, label]) => (
          <label
            key={value}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border cursor-pointer has-checked:border-primary has-checked:bg-primary-soft transition-colors"
          >
            <input
              type="radio"
              name="reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
              className="size-4 accent-[var(--color-primary)]"
            />
            <span className="text-meta text-text">{label}</span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4">
        <TextAreaField
          label={ar.flag.noteLabel}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={400}
          rows={2}
          optional
        />
      </div>
    </Sheet>
  );
}

function ShareButton({ reference }: { reference: string }) {
  const toast = useToast();

  async function share() {
    const url = `${window.location.origin}/r/${reference}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: ar.meta.brand, text: ar.meta.tagline, url });
        return;
      } catch {
        // Dismissed — fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(ar.success.copied, "success");
    } catch {
      toast(ar.errors.generic, "error");
    }
  }

  return (
    <Button variant="secondary" onClick={share}>
      <Share2 className="size-4" aria-hidden strokeWidth={1.75} />
      {ar.common.copy}
    </Button>
  );
}
