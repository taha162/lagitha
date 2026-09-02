"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { PasswordField } from "@/components/ui/password-field";
import { useRestoredForm } from "@/components/ui/use-restored-form";
import {
  completePasswordResetAction,
  requestPasswordResetAction,
} from "@/app/actions/auth";

/**
 * Forgotten password: address, then code and new password on one screen.
 *
 * The second screen never says whether the address had an account — the first
 * step reports success either way, so this form cannot be used to find out who
 * is registered here.
 */
type Step = { name: "identifier" } | { name: "reset"; identifier: string; devDriver: boolean };

export function ResetForm({ next, channel }: { next: string; channel: "email" | "sms" }) {
  const [step, setStep] = useState<Step>({ name: "identifier" });

  if (step.name === "identifier") {
    return (
      <RequestStep
        channel={channel}
        next={next}
        onSent={(identifier, devDriver) => setStep({ name: "reset", identifier, devDriver })}
      />
    );
  }

  return (
    <ResetStep
      identifier={step.identifier}
      devDriver={step.devDriver}
      next={next}
      onBack={() => setStep({ name: "identifier" })}
    />
  );
}

function RequestStep({
  channel,
  next,
  onSent,
}: {
  channel: "email" | "sms";
  next: string;
  onSent: (identifier: string, devDriver: boolean) => void;
}) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);
  const formRef = useRestoredForm(state);

  useEffect(() => {
    if (state?.ok && state.data) onSent(state.data.identifier, state.data.devDriver);
  }, [state, onSent]);

  return (
    <div className="space-y-6">
      <form ref={formRef} action={action} className="space-y-5">
        <div>
          <h1 className="text-h1 text-text-strong">{ar.auth.resetTitle}</h1>
          <p className="mt-1.5 text-meta text-muted leading-relaxed">{ar.auth.resetSubtitle}</p>
        </div>

        <TextField
          name="identifier"
          type={channel === "email" ? "email" : "tel"}
          inputMode={channel === "email" ? "email" : "tel"}
          autoComplete={channel === "email" ? "email" : "tel"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          className="text-start latin"
          label={channel === "email" ? ar.auth.emailLabel : ar.auth.phoneLabel}
          placeholder={channel === "email" ? ar.auth.emailPlaceholder : ar.auth.phonePlaceholder}
          error={state && !state.ok && state.field === "identifier" ? state.error : undefined}
          required
          autoFocus
        />

        {state && !state.ok && !state.field && (
          <p role="alert" className="text-meta text-danger">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.auth.sending}
            </>
          ) : (
            ar.auth.resetSend
          )}
        </Button>
      </form>

      <p className="text-center text-meta">
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="text-primary hover:text-primary-hover"
        >
          {ar.auth.usePassword}
        </Link>
      </p>
    </div>
  );
}

function ResetStep({
  identifier,
  devDriver,
  next,
  onBack,
}: {
  identifier: string;
  devDriver: boolean;
  next: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(completePasswordResetAction, undefined);

  useEffect(() => {
    if (state?.ok && state.data) {
      router.replace(state.data.next);
      router.refresh();
    }
  }, [state, router]);

  const fieldError = (field: string) =>
    state && !state.ok && state.field === field ? state.error : undefined;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="identifier" value={identifier} />
      <input type="hidden" name="next" value={next} />

      <div>
        <h1 className="text-h1 text-text-strong">{ar.auth.resetCodeTitle}</h1>
        <p className="mt-1.5 text-meta text-muted leading-relaxed">{ar.auth.resetSentNote}</p>
      </div>

      {devDriver && (
        <p className="text-fine text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-2">
          {ar.auth.devCodeNotice}
        </p>
      )}

      <TextField
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        className="text-center tracking-[0.4em] text-h1 latin"
        label={ar.auth.codeLabel}
        error={fieldError("code")}
        required
        autoFocus
      />

      <PasswordField
        name="password"
        label={ar.auth.passwordLabel}
        hint={ar.signup.passwordHint(PASSWORD_MIN_LENGTH)}
        autoComplete="new-password"
        error={fieldError("password")}
      />

      <PasswordField
        name="passwordConfirm"
        label={ar.signup.passwordConfirmLabel}
        autoComplete="new-password"
        error={fieldError("passwordConfirm")}
      />

      <p className="text-fine text-muted">{ar.auth.resetSignsOutOthers}</p>

      {state && !state.ok && !state.field && (
        <p role="alert" className="text-meta text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {ar.common.loading}
          </>
        ) : (
          ar.auth.resetSubmit
        )}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-meta text-muted hover:text-text transition-colors"
      >
        <ArrowRight className="size-4" aria-hidden />
        {ar.auth.changeNumber}
      </button>
    </form>
  );
}
