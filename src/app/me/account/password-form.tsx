"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { useToast } from "@/components/ui/toast";
import { changePasswordAction } from "@/app/actions/auth";

/**
 * Changing the password, folded away until asked for.
 *
 * Three password fields permanently open on an account page is noise for the
 * ninety-nine visits out of a hundred that are not about the password. The
 * disclosure keeps the page calm and the form one tap away.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast(ar.account.passwordChanged, "success");
      setOpen(false);
    }
  }, [state, toast]);

  const fieldError = (field: string) =>
    state && !state.ok && state.field === field ? state.error : undefined;

  if (!open) {
    return (
      <div className="space-y-2">
        {!hasPassword && (
          <p className="text-fine text-warning">{ar.account.noPasswordYet}</p>
        )}
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <KeyRound className="size-4" aria-hidden />
          {ar.account.changePasswordOpen}
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {hasPassword && (
        <PasswordField
          name="currentPassword"
          label={ar.account.currentPassword}
          autoComplete="current-password"
          error={fieldError("currentPassword")}
        />
      )}

      <PasswordField
        name="password"
        label={ar.account.newPassword}
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

      {state && !state.ok && !state.field && (
        <p role="alert" className="text-meta text-danger">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.common.loading}
            </>
          ) : (
            ar.account.save
          )}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {ar.common.cancel}
        </Button>
      </div>
    </form>
  );
}
