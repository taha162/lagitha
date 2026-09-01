"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ar } from "@/i18n/ar";
import { cn } from "@/lib/utils";
import { HIGH_CONFIDENCE, confidenceLabel, type MatchReason } from "@/lib/matching";
import type { PublicReport } from "@/lib/privacy";
import { ReportCard } from "@/components/report-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dismissMatchAction } from "@/app/actions/reports";

/**
 * Potential matches.
 *
 * Three rules the UI must never break:
 *   - the wording is "تطابق محتمل", never "we found your item";
 *   - the reasons behind the score are always visible, because a percentage
 *     with no explanation is either believed too much or ignored entirely;
 *   - "مو هو" is as easy to press as anything else.
 */
export interface MatchView {
  id: string;
  score: number;
  reasons: MatchReason[];
  counterpart: PublicReport;
}

export function MatchList({
  matches,
  canDismiss,
}: {
  matches: MatchView[];
  canDismiss: boolean;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const visible = matches.filter((match) => !dismissed.has(match.id));
  if (visible.length === 0) return null;

  async function dismiss(matchId: string) {
    setBusy(matchId);
    const result = await dismissMatchAction(matchId);
    setBusy(null);
    if (result.ok) {
      setDismissed((current) => new Set(current).add(matchId));
      router.refresh();
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4.5 text-primary" aria-hidden strokeWidth={1.75} />
        <h2 className="text-h2 text-text-strong">
          {visible.length === 1 ? ar.match.title : ar.match.plural}
        </h2>
      </div>

      <p className="text-fine text-muted">{ar.match.disclaimer}</p>

      <ul className="space-y-3">
        {visible.map((match) => (
          <li
            key={match.id}
            className="rounded-md border border-border bg-surface overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface-sunken/50">
              <Badge tone={match.score >= HIGH_CONFIDENCE ? "success" : "primary"}>
                {ar.match.scoreLabel(match.score)}
              </Badge>
              <span
                className={cn(
                  "text-fine",
                  match.score >= HIGH_CONFIDENCE ? "text-success" : "text-muted",
                )}
              >
                {confidenceLabel(match.score)}
              </span>
            </div>

            <div className="p-2">
              <ReportCard report={match.counterpart} className="border-0 p-1" />
            </div>

            {match.reasons.length > 0 && (
              <div className="px-3 pb-3">
                <h3 className="text-fine text-muted mb-1.5">{ar.match.reasonsTitle}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {match.reasons.map((reason) => (
                    <li key={reason.code}>
                      <Badge>{reason.label}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canDismiss && (
              <div className="px-3 pb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismiss(match.id)}
                  disabled={busy === match.id}
                >
                  {ar.match.dismiss}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
