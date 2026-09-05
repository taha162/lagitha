"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { PasswordField } from "@/components/ui/password-field";
import { useRestoredForm } from "@/components/ui/use-restored-form";
import { adminSignInAction } from "@/app/actions/admin";

export function AdminSignInForm({ channel }: { channel: "email" | "sms" }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(adminSignInAction, undefined);
  const formRef = useRestoredForm(state);

  useEffect(() => {
    if (state?.ok) {
      router.replace("/admin");
      router.refresh();
    }
  }, [state, router]);

  const fieldError = (field: string) =>
    state && !state.ok && state.field === field ? state.error : undefined;

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <TextField
        name="identifier"
        type={channel === "email" ? "email" : "tel"}
        inputMode={channel === "email" ? "email" : "tel"}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        dir="ltr"
        className="text-start latin"
        label={channel === "email" ? ar.auth.emailLabel : ar.auth.phoneLabel}
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
          ar.admin.signInButton
        )}
      </Button>
    </form>
  );
}
