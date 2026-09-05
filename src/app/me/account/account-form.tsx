"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { signOutAction, signOutEverywhereAction } from "@/app/actions/auth";

/**
 * Sessions and signing out. The editable fields live in `ProfileForm`; this is
 * only the part that ends a session, which is why it sits under "security".
 */
export function AccountForm({
  displayName: _displayName,
  sessionCount,
}: {
  displayName: string;
  sessionCount: number;
}) {
  const router = useRouter();
  const [signingOut, startSignOut] = useTransition();

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
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
