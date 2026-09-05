import { ar } from "@/i18n/ar";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/authz";
import { maskIdentifier } from "@/lib/privacy";
import { formatDate, relativeTime } from "@/lib/time";
import { PageHeader, Panel, DataTable } from "@/components/admin/panel";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "./user-actions";
import { UserSearch } from "./user-search";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.users };

const STATUS_TONE = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  BANNED: "danger",
} as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const viewer = await getCurrentUser();
  const canAct = isAdmin(viewer);

  const users = await prisma.user.findMany({
    // The identifier column is masked, so an address typed from a support
    // message is the only handle staff have on a person. Searching it was
    // left out when the platform moved from phone numbers to email, which made
    // every account unfindable by the one thing anyone knows about it.
    where: q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 60,
    include: {
      _count: { select: { reports: true, flagsRaised: true } },
    },
  });

  return (
    <>
      <PageHeader
        title={ar.admin.nav.users}
        description={
          canAct ? undefined : "الإجراءات على الحسابات متاحة للمدراء فقط."
        }
        actions={<UserSearch current={q ?? ""} />}
      />

      <Panel>
        <DataTable
          headers={[
            "الاسم",
            "المعرّف",
            "الدور",
            "الحالة",
            "بلاغات",
            ar.account.memberSince,
            "آخر ظهور",
            "",
          ]}
          empty={
            users.length === 0
              ? q
                ? `ما لگينا حساباً يطابق «${q}».`
                : "ما في مستخدمين."
              : undefined
          }
        >
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-surface-sunken/50">
              <td className="px-3 py-2 max-w-[12rem]">
                <span className="block truncate text-text">{user.displayName}</span>
              </td>
              <td className="px-3 py-2 text-fine text-muted latin whitespace-nowrap" dir="ltr">
                {maskIdentifier(user)}
              </td>
              <td className="px-3 py-2">
                {user.role === "MEMBER" ? (
                  <span className="text-fine text-muted">عضو</span>
                ) : (
                  <Badge tone="primary">{user.role === "ADMIN" ? "مدير" : "مشرف"}</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[user.status]}>
                  {user.status === "ACTIVE"
                    ? "نشط"
                    : user.status === "SUSPENDED"
                      ? "موقوف"
                      : "محظور"}
                </Badge>
              </td>
              <td className="px-3 py-2 text-fine text-muted latin tabular-nums">
                {user._count.reports}
              </td>
              <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                {formatDate(user.createdAt)}
              </td>
              <td className="px-3 py-2 text-fine text-muted whitespace-nowrap">
                {relativeTime(user.lastSeenAt)}
              </td>
              <td className="px-3 py-2">
                {canAct && viewer?.id !== user.id ? (
                  <UserActions
                    userId={user.id}
                    displayName={user.displayName}
                    role={user.role}
                    status={user.status}
                  />
                ) : (
                  <span className="text-fine text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}
