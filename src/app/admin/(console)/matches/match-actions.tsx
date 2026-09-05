"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { matchActionAction } from "@/app/actions/admin";

export function MatchActions({ matchId }: { matchId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: "confirm" | "dismiss") {
    setBusy(true);
    const result = await matchActionAction({ matchId, action });
    setBusy(false);

    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => run("confirm")} disabled={busy}>
        {ar.admin.actions.confirmMatch}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => run("dismiss")} disabled={busy}>
        {ar.admin.actions.dismissMatch}
      </Button>
    </div>
  );
}
