"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import {
  completeProfileAction,
  requestCodeAction,
  verifyCodeAction,
} from "@/app/actions/auth";

/**
 * Three short steps: number → code → name. Deliberately not a "create an
 * account" form — a person who has just lost their wallet should not be asked
 * for an email address and a password before they can say so.
 */
type Step =
  | { name: "phone" }
  | { name: "code"; phone: string; display: string; devDriver: boolean }
  | { name: "profile" };

export function LoginForm({ next, startAtProfile }: { next: string; startAtProfile: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(startAtProfile ? { name: "profile" } : { name: "phone" });

  if (step.name === "phone") {
    return <PhoneStep onSent={(data) => setStep({ name: "code", ...data })} />;
  }

  if (step.name === "code") {
    return (
      <CodeStep
        phone={step.phone}
        display={step.display}
        devDriver={step.devDriver}
        next={next}
        onBack={() => setStep({ name: "phone" })}
        onVerified={(isNewUser, target) => {
          if (isNewUser) setStep({ name: "profile" });
          else router.replace(target);
        }}
      />
    );
  }

  return (
    <ProfileStep
      onDone={() => {
        router.replace(next);
        router.refresh();
      }}
    />
  );
}

function PhoneStep({
  onSent,
}: {
  onSent: (data: { phone: string; display: string; devDriver: boolean }) => void;
}) {
  const [state, action, pending] = useActionState(requestCodeAction, undefined);

  useEffect(() => {
    if (state?.ok && state.data) onSent(state.data);
  }, [state, onSent]);

  return (
    <form action={action} className="space-y-5">
      <div>
        <h1 className="text-h1 text-text-strong">{ar.auth.title}</h1>
        <p className="mt-1.5 text-meta text-muted leading-relaxed">{ar.auth.subtitle}</p>
      </div>

      <TextField
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        className="text-start latin"
        label={ar.auth.phoneLabel}
        placeholder={ar.auth.phonePlaceholder}
        hint={ar.auth.phoneHint}
        error={state && !state.ok && state.field === "phone" ? state.error : undefined}
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
  );
}

const RESEND_SECONDS = 45;

function CodeStep({
  phone,
  display,
  devDriver,
  next,
  onBack,
  onVerified,
}: {
  phone: string;
  display: string;
  devDriver: boolean;
  next: string;
  onBack: () => void;
  onVerified: (isNewUser: boolean, next: string) => void;
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
    if (state?.ok && state.data) onVerified(state.data.isNewUser, state.data.next);
  }, [state, onVerified]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="next" value={next} />

      <div>
        <h1 className="text-h1 text-text-strong">{ar.auth.codeTitle}</h1>
        <p className="mt-1.5 text-meta text-muted">
          {ar.auth.codeSubtitle("")}
          <span dir="ltr" className="latin"> {display}</span>
        </p>
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

function ProfileStep({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(completeProfileAction, undefined);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-5">
      <div>
        <h1 className="text-h1 text-text-strong">{ar.auth.nameTitle}</h1>
        <p className="mt-1.5 text-meta text-muted leading-relaxed">{ar.auth.nameSubtitle}</p>
      </div>

      <TextField
        name="displayName"
        label={ar.auth.nameLabel}
        placeholder={ar.auth.namePlaceholder}
        autoComplete="nickname"
        maxLength={40}
        error={state && !state.ok ? state.error : undefined}
        required
        autoFocus
      />

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {ar.common.loading}
          </>
        ) : (
          ar.auth.finish
        )}
      </Button>
    </form>
  );
}
