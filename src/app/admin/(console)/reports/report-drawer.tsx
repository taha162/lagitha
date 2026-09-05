"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { ar } from "@/i18n/ar";
import { formatDateTime } from "@/lib/time";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge, ReportTypeBadge } from "@/components/ui/badge";
import { DeleteDialog } from "@/components/admin/delete-dialog";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  changeReportCategoryAction,
  rematchReportAction,
  deleteReportAction,
  reportActionAction,
} from "@/app/actions/admin";

/**
 * Review drawer.
 *
 * Every button here writes an audit entry naming the actor. The reason field is
 * optional for reversible actions and required in the schema for user-level
 * ones, which is the line between "tidying the queue" and "acting on a person".
 */
export interface AdminReportView {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  type: "LOST" | "FOUND";
  status: string;
  moderation: string;
  sensitivity: string;
  categorySlug: string;
  categoryName: string;
  areaLabel: string;
  preciseLat: number | null;
  preciseLng: number | null;
  authorName: string;
  authorPhone: string;
  createdAt: string;
  viewCount: number;
  flagCount: number;
  imageUrl: string | null;
  hasSecret: boolean;
}

export function ReportDrawer({
  report,
  categories,
  canDelete,
}: {
  report: AdminReportView;
  categories: { slug: string; nameAr: string }[];
  /** Deleting is admin-only; a moderator hides. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const close = () => router.push("/admin/reports", { scroll: false });

  async function run(action: string) {
    setBusy(true);
    const result = await reportActionAction({
      reportId: report.id,
      action,
      reason: reason.trim() || undefined,
    });
    setBusy(false);

    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  async function recategorise(slug: string) {
    if (slug === report.categorySlug) return;
    setBusy(true);
    const result = await changeReportCategoryAction({
      reportId: report.id,
      categorySlug: slug,
      reason: reason.trim() || undefined,
    });
    setBusy(false);

    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  async function rematch() {
    setBusy(true);
    const result = await rematchReportAction(report.id);
    setBusy(false);
    toast(result.ok ? ar.admin.actions.done : result.error, result.ok ? "success" : "error");
    if (result.ok) router.refresh();
  }

  return (
    <Sheet
      open
      onClose={close}
      variant="dialog"
      title={report.title}
      description={`${report.reference} · ${report.categoryName}`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ReportTypeBadge type={report.type} />
          <Badge tone={report.moderation === "VISIBLE" ? "success" : "warning"}>
            {report.moderation}
          </Badge>
          <Badge>{report.status}</Badge>
          {report.sensitivity === "SENSITIVE" && <Badge tone="warning">حساس</Badge>}
          {report.flagCount > 0 && (
            <Badge tone="danger">{report.flagCount} شكوى</Badge>
          )}
          <Link
            href={`/r/${report.reference}`}
            target="_blank"
            className="ms-auto inline-flex items-center gap-1 text-fine text-primary hover:text-primary-hover"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            عرض عام
          </Link>
        </div>

        {report.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={report.imageUrl}
            alt=""
            className="w-full max-h-56 object-contain rounded-md border border-border bg-surface-sunken"
          />
        )}

        {report.description && (
          <p className="text-meta text-text whitespace-pre-wrap">{report.description}</p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-fine">
          <Row label={ar.report.area} value={report.areaLabel} />
          <Row
            label="الإحداثيات الدقيقة"
            value={
              report.preciseLat && report.preciseLng
                ? `${report.preciseLat.toFixed(5)}, ${report.preciseLng.toFixed(5)}`
                : "غير مسجّلة"
            }
            latin
          />
          <Row label={ar.report.reportedBy} value={report.authorName} />
          <Row label="الهاتف" value={report.authorPhone} latin />
          <Row label={ar.report.publishedAt} value={formatDateTime(report.createdAt)} />
          <Row label="المشاهدات" value={String(report.viewCount)} latin />
          <Row
            label={ar.wizard.secretTitle}
            value={report.hasSecret ? "مسجّل" : "غير مسجّل"}
          />
        </dl>

        <div className="pt-3 border-t border-border space-y-3">
          <TextField
            label={ar.admin.actions.reasonLabel}
            hint={ar.admin.actions.reasonRequired}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            optional
          />

          <div>
            <label
              htmlFor="recategorise"
              className="block text-meta font-medium text-text mb-1.5"
            >
              {ar.admin.actions.changeCategory}
            </label>
            <select
              id="recategorise"
              defaultValue={report.categorySlug}
              onChange={(event) => recategorise(event.target.value)}
              disabled={busy}
              className="w-full h-9 px-2 rounded-sm border border-border-strong bg-surface text-meta"
            >
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {report.moderation === "VISIBLE" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => run("review")} disabled={busy}>
                  {ar.admin.actions.review}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => run("hide")} disabled={busy}>
                  {ar.admin.actions.hide}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => run("approve")} disabled={busy}>
                {ar.admin.actions.approve}
              </Button>
            )}

            <Button size="sm" variant="danger" onClick={() => run("reject")} disabled={busy}>
              {ar.admin.actions.reject}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(report.sensitivity === "SENSITIVE" ? "mark-normal" : "mark-sensitive")}
              disabled={busy}
            >
              {report.sensitivity === "SENSITIVE"
                ? ar.admin.actions.markNormal
                : ar.admin.actions.markSensitive}
            </Button>

            {report.status === "ACTIVE" ? (
              <Button size="sm" variant="ghost" onClick={() => run("close")} disabled={busy}>
                {ar.admin.actions.close}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => run("reopen")} disabled={busy}>
                {ar.admin.actions.reopen}
              </Button>
            )}

            <Button size="sm" variant="ghost" onClick={rematch} disabled={busy}>
              <RefreshCw className="size-3.5" aria-hidden strokeWidth={1.75} />
              {ar.admin.nav.matches}
            </Button>
          </div>

          {/* Separated from the reversible actions above by a rule, because it
              is the only one of them that cannot be undone. */}
          {canDelete && (
            <div className="pt-3 border-t border-border">
              <DeleteDialog
                label={ar.admin.actions.deleteReport}
                title={ar.admin.actions.deleteReport}
                body={ar.admin.actions.deleteReportConfirm}
                confirmWord={report.reference}
                onDelete={({ confirm, reason }) =>
                  deleteReportAction({ id: report.id, confirm, reason })
                }
                onDeleted={close}
              />
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Row({
  label,
  value,
  latin = false,
}: {
  label: string;
  value: string;
  latin?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={latin ? "text-text latin" : "text-text"}>{value}</dd>
    </div>
  );
}
