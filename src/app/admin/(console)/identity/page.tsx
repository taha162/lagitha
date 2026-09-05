import { ar } from "@/i18n/ar";
import { maskIdentifier } from "@/lib/privacy";
import { pendingIdentities, recentIdentityDecisions } from "@/lib/services/identity";
import { formatDate, relativeTime } from "@/lib/time";
import { PageHeader, Panel, DataTable } from "@/components/admin/panel";
import { Badge } from "@/components/ui/badge";
import { IdentityReview } from "./identity-review";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.identity };

/**
 * The identity queue.
 *
 * Two tables: cards waiting, and what was decided recently. The second one
 * exists so a reviewer can see their own decisions without opening the audit
 * log — and so that a run of rejections is visible to whoever is next on shift.
 * Neither table can show an image; that takes a deliberate click, and the click
 * is recorded.
 */
export default async function AdminIdentityPage() {
  const [pending, decided] = await Promise.all([
    pendingIdentities(),
    recentIdentityDecisions(),
  ]);

  return (
    <>
      <PageHeader
        title={ar.admin.nav.identity}
        description={`${pending.length} بطاقة تنتظر المراجعة`}
      />

      <Panel>
        <DataTable
          headers={[
            ar.identity.adminAccountName,
            ar.identity.adminCardName,
            "الحساب",
            ar.identity.submittedAt,
            "",
          ]}
          empty={pending.length === 0 ? ar.identity.adminQueueEmpty : undefined}
        >
          {pending.map((record) => (
            <tr key={record.id} className="hover:bg-surface-sunken/50 align-top">
              <td className="px-3 py-3 text-text">{record.user.displayName}</td>
              <td className="px-3 py-3 text-text">{record.cardName ?? "—"}</td>
              <td className="px-3 py-3 text-muted latin" dir="ltr">
                {maskIdentifier(record.user)}
              </td>
              <td className="px-3 py-3 text-muted whitespace-nowrap">
                {relativeTime(record.submittedAt)}
              </td>
              <td className="px-3 py-3">
                <IdentityReview verificationId={record.id} />
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      {decided.length > 0 && (
        <Panel title="قرارات سابقة">
          <DataTable
            headers={[
              ar.identity.adminAccountName,
              "القرار",
              ar.identity.decisionNote,
              ar.admin.audit.actor,
              ar.identity.reviewedAt,
            ]}
          >
            {decided.map((record) => (
              <tr key={record.id} className="hover:bg-surface-sunken/50 align-top">
                <td className="px-3 py-2 text-text">{record.user.displayName}</td>
                <td className="px-3 py-2">
                  <Badge tone={record.status === "APPROVED" ? "success" : "danger"}>
                    {record.status === "APPROVED"
                      ? ar.identity.badge
                      : ar.identity.statusRejectedTitle}
                  </Badge>
                </td>
                <td className="px-3 py-2 max-w-xs text-muted">{record.decisionNote ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{record.reviewedBy?.displayName ?? "—"}</td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">
                  {record.reviewedAt ? formatDate(record.reviewedAt) : "—"}
                  <span className="block text-fine">{ar.identity.adminPurged}</span>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}
    </>
  );
}
