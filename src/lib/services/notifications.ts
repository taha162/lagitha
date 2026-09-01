import "server-only";
import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "../db";

/**
 * In-app notifications.
 *
 * V1 is deliberately in-app only: push needs a service worker, a key pair, a
 * delivery service and a permission prompt, none of which change whether the
 * product works. The payload here is structured (never a rendered sentence),
 * so adding push or SMS later means adding a transport, not a data migration.
 */

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  reportId?: string | null;
  matchId?: string | null;
  conversationId?: string | null;
  verificationId?: string | null;
  payload?: Record<string, unknown>;
}

export async function notify(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      reportId: input.reportId ?? null,
      matchId: input.matchId ?? null,
      conversationId: input.conversationId ?? null,
      verificationId: input.verificationId ?? null,
      payload: (input.payload ?? {}) as never,
    },
  });
}

/**
 * Suppresses a duplicate notification within a window, so a user whose report
 * matches five times in a minute is not buried.
 */
export async function notifyOnce(
  input: CreateNotificationInput,
  windowMinutes = 60,
): Promise<void> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      reportId: input.reportId ?? undefined,
      matchId: input.matchId ?? undefined,
      createdAt: { gte: since },
    },
    select: { id: true },
  });

  if (existing) return;
  await notify(input);
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      report: { select: { reference: true, title: true, type: true } },
      conversation: { select: { id: true } },
    },
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}
