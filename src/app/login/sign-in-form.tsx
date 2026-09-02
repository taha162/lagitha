"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { PasswordField } from "@/components/ui/password-field";
import { useRestoredForm } from "@/components/ui/use-restored-form";
import { signInAction } from "@/app/actions/auth";

/**
 * Signing in: address and password, and nothing else on the screen.
 *
 * The two ways out — "forgot" and "no account" — sit below the button rather
 * than beside the fields, because someone who is signing in successfully should
 * never have to read past them.
 */
export function SignInForm({ next, channel }: { next: string; channel: "email" | "sms" }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(signInAction, undefined);
  // Mistyping a password should not also clear the address above it.
  const formRef = useRestoredForm(state);

  useEffect(() => {
    if (state?.ok && state.data) {
      router.replace(state.data.next);
      router.refresh();
    }
  }, [state, router]);

  const fieldError = (field: string) =>
    state && !state.ok && state.field === field ? state.error : undefined;

  return (
    <div className="space-y-6">
      <form ref={formRef} action={action} className="space-y-5">
        <input type="hidden" name="next" value={next} />

        <div>
          <h1 className="text-h1 text-text-strong">{ar.auth.title}</h1>
          <p className="mt-1.5 text-meta text-muted">{ar.auth.passwordSubtitle}</p>
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
          error={fieldError("identifier")}
          required
          autoFocus
        />

        <PasswordField
          name="password"
          label={ar.auth.passwordLabel}
          autoComplete="current-password"
          error={fieldError("password")}
        />

        {state && !state.ok && !state.field && (
          <p role="alert" className="text-meta text-danger leading-relaxed">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.auth.signingIn}
            </>
          ) : (
            ar.auth.signIn
          )}
        </Button>
      </form>

      <div className="space-y-3 text-center text-meta">
        <p>
          <Link
            href={`/login/reset?next=${encodeURIComponent(next)}`}
            className="text-primary hover:text-primary-hover"
          >
            {ar.auth.forgotPassword}
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

      <div className="pt-4 border-t border-border text-center">
        <Link
          href={`/login/code?next=${encodeURIComponent(next)}`}
          className="text-fine text-muted hover:text-text transition-colors"
        >
          {ar.auth.orUseCode}
        </Link>
      </div>
    </div>
  );
}
