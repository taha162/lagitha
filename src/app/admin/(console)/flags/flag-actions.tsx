"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { flagActionAction } from "@/app/actions/admin";

export function FlagActions({ flagId }: { flagId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: "resolve" | "dismiss") {
    setBusy(true);
    const result = await flagActionAction({ flagId, action });
    setBusy(false);

    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex gap-1.5 whitespace-nowrap">
      <Button size="sm" onClick={() => run("resolve")} disabled={busy}>
        {ar.admin.actions.resolveFlag}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => run("dismiss")} disabled={busy}>
        {ar.admin.actions.dismissFlag}
      </Button>
    </div>
  );
}
