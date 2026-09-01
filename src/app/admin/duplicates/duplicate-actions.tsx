"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { duplicateActionAction } from "@/app/actions/admin";

export function DuplicateActions({
  matchId,
  options,
}: {
  matchId: string;
  options: { id: string; reference: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [keepReportId, setKeepReportId] = useState(options[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function run(action: "merge" | "keep-both") {
    setBusy(true);
    const result = await duplicateActionAction({ matchId, action, keepReportId });
    setBusy(false);

    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => run("keep-both")} disabled={busy}>
        {ar.admin.duplicates.keep}
      </Button>

      <span className="text-fine text-muted">|</span>

      <label className="flex items-center gap-1.5 text-fine text-muted">
        نحتفظ بـ
        <select
          value={keepReportId}
          onChange={(event) => setKeepReportId(event.target.value)}
          className="h-8 px-2 rounded-sm border border-border-strong bg-surface text-fine latin"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.reference}
            </option>
          ))}
        </select>
      </label>

      <Button size="sm" onClick={() => run("merge")} disabled={busy}>
        {ar.admin.duplicates.merge}
      </Button>
    </div>
  );
}
