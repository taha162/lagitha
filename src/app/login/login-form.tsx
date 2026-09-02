"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useRestoredForm } from "@/components/ui/use-restored-form";
import { requestCodeAction, verifyCodeAction } from "@/app/actions/auth";

/**
 * Signing in with a one-time code instead of a password.
 *
 * This is the fallback, not the front door: accounts created before passwords
 * existed have no password to type, and anyone who cannot get to their own
 * password still has their inbox. It does not create accounts — that happens
 * once, on the sign-up screen, where a name and a password are collected.
 */
type Step =
  | { name: "identifier" }
  | { name: "code"; identifier: string; display: string; devDriver: boolean };

export function LoginForm({ next, channel }: { next: string; channel: "email" | "sms" }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "identifier" });

  if (step.name === "identifier") {
    return (
      <IdentifierStep channel={channel} next={next} onSent={(data) => setStep({ name: "code", ...data })} />
    );
  }

  return (
    <CodeStep
      identifier={step.identifier}
      display={step.display}
      devDriver={step.devDriver}
      channel={channel}
      next={next}
      onBack={() => setStep({ name: "identifier" })}
      onVerified={(target) => {
        router.replace(target);
        router.refresh();
      }}
    />
  );
}

function IdentifierStep({
  channel,
  next,
  onSent,
}: {
  channel: "email" | "sms";
  next: string;
  onSent: (data: { identifier: string; display: string; devDriver: boolean }) => void;
}) {
  const [state, action, pending] = useActionState(requestCodeAction, undefined);
  const formRef = useRestoredForm(state);

  useEffect(() => {
    if (state?.ok && state.data) onSent(state.data);
  }, [state, onSent]);

  return (
    <div className="space-y-6">
      <form ref={formRef} action={action} className="space-y-5">
        <div>
          <h1 className="text-h1 text-text-strong">{ar.auth.codeLoginTitle}</h1>
          <p className="mt-1.5 text-meta text-muted leading-relaxed">
            {ar.auth.codeLoginSubtitle}
          </p>
        </div>

        {/* The identifier is always typed left-to-right, whichever channel it is. */}
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
          hint={channel === "email" ? ar.auth.emailHint : ar.auth.phoneHint}
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
            ar.auth.sendCode
          )}
        </Button>
      </form>

      <div className="pt-4 border-t border-border text-center space-y-3 text-meta">
        <p>
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="text-primary hover:text-primary-hover"
          >
            {ar.auth.usePassword}
          </Link>
        </p>
        <p className="text-muted">
          {ar.auth.noAccount}{" "}
          <Link
            href={`/signup?next=${encodeURIComponent(next)}`}
            className="text-primary hover:text-primary-hover font-medium"
          >
            {ar.auth.createAccount}
          </Link>
        </p>
      </div>
    </div>
  );
}

const RESEND_SECONDS = 45;

function CodeStep({
  identifier,
  display,
  devDriver,
  channel,
  next,
  onBack,
  onVerified,
}: {
  identifier: string;
  display: string;
  devDriver: boolean;
  channel: "email" | "sms";
  next: string;
  onBack: () => void;
  onVerified: (next: string) => void;
}) {
  const [state, action, pending] = useActionState(verifyCodeAction, undefined);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  useEffect(() => {
    if (state?.ok && state.data) onVerified(state.data.next);
  }, [state, onVerified]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="identifier" value={identifier} />
      <input type="hidden" name="next" value={next} />

      <div>
        <h1 className="text-h1 text-text-strong">{ar.auth.codeTitle}</h1>
        <p className="mt-1.5 text-meta text-muted">
          {ar.auth.codeSubtitle("")}
          <span dir="ltr" className="latin"> {display}</span>
        </p>
        {channel === "email" && <p className="mt-2 text-fine text-muted">{ar.auth.checkSpam}</p>}
      </div>

      {devDriver && (
        <p className="text-fine text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-2">
          {ar.auth.devCodeNotice}
        </p>
      )}

      <TextField
        ref={inputRef}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        className="text-center tracking-[0.4em] text-h1 latin"
        label={ar.auth.codeLabel}
        error={state && !state.ok ? state.error : undefined}
        required
      />

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {ar.auth.verifying}
          </>
        ) : (
          ar.auth.verify
        )}
      </Button>

      <div className="flex items-center justify-between text-meta">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-muted hover:text-text transition-colors"
        >
          <ArrowRight className="size-4" aria-hidden />
          {ar.auth.changeNumber}
        </button>

        {secondsLeft > 0 ? (
          <span className="text-muted">{ar.auth.resendIn(secondsLeft)}</span>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="text-primary hover:text-primary-hover transition-colors"
          >
            {ar.auth.resend}
          </button>
        )}
      </div>
    </form>
  );
}
