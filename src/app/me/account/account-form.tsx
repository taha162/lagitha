"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  completeProfileAction,
  signOutAction,
  signOutEverywhereAction,
} from "@/app/actions/auth";

export function AccountForm({
  displayName,
  sessionCount,
}: {
  displayName: string;
  sessionCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(completeProfileAction, undefined);
  const [name, setName] = useState(displayName);
  const [signingOut, startSignOut] = useTransition();

  useEffect(() => {
    if (state?.ok) {
      toast(ar.account.saved, "success");
      router.refresh();
    }
  }, [state, toast, router]);

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-3">
        <TextField
          name="displayName"
          label={ar.account.displayName}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          error={state && !state.ok ? state.error : undefined}
          required
        />
        <Button type="submit" disabled={pending || name === displayName}>
          {ar.account.save}
        </Button>
      </form>

      <div className="pt-4 border-t border-border space-y-2.5">
        <p className="text-meta text-muted">
          {ar.account.sessions}: <span className="latin tabular-nums">{sessionCount}</span>
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={signingOut}
            onClick={() =>
              startSignOut(async () => {
                await signOutAction();
                router.push("/");
                router.refresh();
              })
            }
          >
            {ar.nav.signOut}
          </Button>

          {sessionCount > 1 && (
            <Button
              variant="ghost"
              disabled={signingOut}
              onClick={() =>
                startSignOut(async () => {
                  await signOutEverywhereAction();
                  router.push("/");
                  router.refresh();
                })
              }
            >
              {ar.account.signOutAll}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
