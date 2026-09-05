import { ar } from "@/i18n/ar";
import { adminAuditLog } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/time";
import { PageHeader, Panel, DataTable } from "@/components/admin/panel";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.audit };

/**
 * The audit log is append-only by construction: nothing in the application
 * updates or deletes an `AdminAction`. If a decision was made, it is here.
 */
export default async function AdminAuditPage() {
  const actions = await adminAuditLog(150);

  return (
    <>
      <PageHeader title={ar.admin.audit.title} description={`آخر ${actions.length} إجراء`} />

      <Panel>
        <DataTable
          headers={[
            ar.admin.audit.when,
            ar.admin.audit.actor,
            ar.admin.audit.action,
            ar.admin.audit.entity,
            "تفاصيل",
          ]}
          empty={actions.length === 0 ? ar.admin.audit.empty : undefined}
        >
          {actions.map((action) => (
            <tr key={action.id} className="hover:bg-surface-sunken/50 align-top">
              <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                {formatDateTime(action.createdAt)}
              </td>
              <td className="px-3 py-2 max-w-[10rem]">
                <span className="block truncate text-text">{action.actor.displayName}</span>
                <span className="text-fine text-muted">
                  {action.actor.role === "ADMIN" ? "مدير" : "مشرف"}
                </span>
              </td>
              <td className="px-3 py-2">
                <Badge tone={toneFor(action.action)}>
                  <span className="latin">{action.action}</span>
                </Badge>
              </td>
              <td className="px-3 py-2 text-fine text-muted latin whitespace-nowrap">
                {action.entityType}
              </td>
              <td className="px-3 py-2 max-w-md">
                <pre className="text-[11px] text-muted whitespace-pre-wrap break-all latin" dir="ltr">
                  {JSON.stringify(action.metadata ?? {}, null, 0)}
                </pre>
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}

function toneFor(action: string): "danger" | "warning" | "primary" {
  if (action.includes("reject") || action.includes("ban") || action.includes("hide")) {
    return "danger";
  }
  if (action.includes("suspend") || action.includes("review") || action.includes("merge")) {
    return "warning";
  }
  return "primary";
}
