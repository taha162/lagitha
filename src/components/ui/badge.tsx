import { cn } from "@/lib/utils";
import { ar } from "@/i18n/ar";
import type { ReportStatus, ReportType } from "@/generated/prisma/client";
import type { ReactNode } from "react";

type Tone = "neutral" | "lost" | "found" | "success" | "warning" | "danger" | "primary";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-muted border-border",
  lost: "bg-lost-soft text-lost border-lost/25",
  found: "bg-found-soft text-found border-found/25",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/25",
  primary: "bg-primary-soft text-primary border-primary/20",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border rounded-sm px-2 py-0.5",
        "text-fine font-medium leading-5 whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * LOST vs FOUND. The word carries the meaning — colour is a reinforcement, so
 * the distinction survives greyscale and colour-blindness.
 */
export function ReportTypeBadge({ type, className }: { type: ReportType; className?: string }) {
  return (
    <Badge tone={type === "LOST" ? "lost" : "found"} className={className}>
      {type === "LOST" ? ar.report.lost : ar.report.found}
    </Badge>
  );
}

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  if (status === "ACTIVE") return null;
  return (
    <Badge tone={status === "RECOVERED" ? "success" : "neutral"}>
      {status === "RECOVERED" ? ar.report.statusRecovered : ar.report.statusClosed}
    </Badge>
  );
}
