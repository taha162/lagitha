import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@/generated/prisma/client";
import { getCurrentUser } from "./auth";
import { prisma } from "./db";
import { PUBLIC_AUTHOR_SELECT } from "./privacy";

/**
 * Every authorization decision in the product lives here.
 *
 * Pages, server actions and route handlers ask this module; none of them
 * compare `userId` fields themselves. That makes the rules auditable in one
 * place and testable without a browser.
 */

export class AuthorizationError extends Error {
  constructor(
    override readonly message: string,
    readonly kind: "unauthenticated" | "forbidden" | "not-found" = "forbidden",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function isStaff(user: Pick<User, "role"> | null): boolean {
  return user?.role === "ADMIN" || user?.role === "MODERATOR";
}

export function isAdmin(user: Pick<User, "role"> | null): boolean {
  return user?.role === "ADMIN";
}

export function isActive(user: Pick<User, "status"> | null): boolean {
  return user?.status === "ACTIVE";
}

/** For server actions: throws rather than redirecting. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("سجّل دخولك أول.", "unauthenticated");
  if (!isActive(user)) throw new AuthorizationError("حسابك موقوف حالياً.", "forbidden");
  return user;
}

/** For pages: sends the visitor to sign-in and back again. */
export async function requireUserPage(returnTo: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user || !isActive(user)) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return user;
}

export async function requireStaff(): Promise<User> {
  const user = await requireUser();
  if (!isStaff(user)) throw new AuthorizationError("ما عندك صلاحية لهذه الصفحة.", "forbidden");
  return user;
}

export async function requireStaffPage(returnTo: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user || !isActive(user)) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (!isStaff(user)) redirect("/");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new AuthorizationError("هذا الإجراء متاح للمدراء فقط.", "forbidden");
  return user;
}

// ------------------------------------------------------------- reports ----

interface ReportOwnership {
  id: string;
  userId: string;
  moderation: string;
  status: string;
}

/** Can this viewer read the report at all? */
export function canViewReport(
  report: ReportOwnership,
  viewer: Pick<User, "id" | "role"> | null,
): boolean {
  if (viewer && report.userId === viewer.id) return true;
  if (isStaff(viewer)) return true;
  return report.moderation === "VISIBLE";
}

export function canEditReport(
  report: ReportOwnership,
  viewer: Pick<User, "id" | "role"> | null,
): boolean {
  if (!viewer) return false;
  if (report.userId === viewer.id) return report.status === "ACTIVE";
  return isStaff(viewer);
}

export function canModerate(viewer: Pick<User, "role"> | null): boolean {
  return isStaff(viewer);
}

/**
 * Loads a report and enforces read access in one step, so a caller cannot
 * forget the check. Throws `not-found` rather than `forbidden` for reports the
 * viewer may not see — a 403 would confirm the report exists.
 */
export async function loadViewableReport(reference: string, viewer: User | null) {
  const report = await prisma.report.findUnique({
    where: { reference },
    include: {
      category: true,
      area: true,
      images: { orderBy: { position: "asc" } },
      user: { select: PUBLIC_AUTHOR_SELECT },
    },
  });

  if (!report) throw new AuthorizationError("ما لگينا هذا البلاغ.", "not-found");
  if (!canViewReport(report, viewer)) {
    throw new AuthorizationError("ما لگينا هذا البلاغ.", "not-found");
  }

  return report;
}

/** Loads a report the viewer is allowed to modify. */
export async function loadEditableReport(reference: string, viewer: User) {
  const report = await loadViewableReport(reference, viewer);
  if (!canEditReport(report, viewer)) {
    throw new AuthorizationError("ما تگدر تعدّل هذا البلاغ.", "forbidden");
  }
  return report;
}

// ------------------------------------------------------- conversations ----

export function canAccessConversation(
  conversation: { initiatorId: string; ownerId: string },
  viewer: Pick<User, "id" | "role"> | null,
): boolean {
  if (!viewer) return false;
  // Staff can moderate a reported thread but are not silent participants:
  // reading one is an audited action (see readConversationAsStaff).
  return conversation.initiatorId === viewer.id || conversation.ownerId === viewer.id;
}

export async function loadConversationForViewer(conversationId: string, viewer: User) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      report: {
        include: {
          category: true,
          images: { orderBy: { position: "asc" }, take: 1 },
        },
      },
      initiator: { select: { id: true, displayName: true } },
      owner: { select: { id: true, displayName: true } },
    },
  });

  if (!conversation) throw new AuthorizationError("ما لگينا المحادثة.", "not-found");
  if (!canAccessConversation(conversation, viewer)) {
    throw new AuthorizationError("ما لگينا المحادثة.", "not-found");
  }

  return conversation;
}

// ------------------------------------------------------- verification -----

export function canDecideVerification(
  request: { report: { userId: string } },
  viewer: Pick<User, "id" | "role"> | null,
): boolean {
  if (!viewer) return false;
  return request.report.userId === viewer.id || isStaff(viewer);
}

export function canViewVerification(
  request: { claimantId: string; report: { userId: string } },
  viewer: Pick<User, "id" | "role"> | null,
): boolean {
  if (!viewer) return false;
  return (
    request.claimantId === viewer.id ||
    request.report.userId === viewer.id ||
    isStaff(viewer)
  );
}

// ------------------------------------------------------------- audit -----

/**
 * Records a staff action. Called by every admin mutation — the argument list
 * is deliberately awkward to skip.
 */
export async function recordAdminAction(params: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.adminAction.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? {}) as never,
    },
  });
}
