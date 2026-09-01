import "server-only";
import type { User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { AuthorizationError } from "../authz";
import { containsPhoneNumber } from "../arabic";
import { consumeRateLimit } from "../rate-limit";
import { notifyOnce } from "./notifications";

/**
 * Platform messaging.
 *
 * Every thread is anchored to a report and has exactly two participants, so
 * there is no inbox to spam and no way to reach someone you have no business
 * with. Phone numbers are never exposed by the platform; if a user types one
 * anyway we flag the message and show a warning rather than silently editing
 * what they wrote.
 */

export class MessagingError extends Error {
  constructor(
    override readonly message: string,
    readonly code: "own-report" | "rate-limited" | "closed",
  ) {
    super(message);
    this.name = "MessagingError";
  }
}

export async function startConversation(params: {
  sender: User;
  reference: string;
  body: string;
  matchId?: string;
}) {
  const report = await prisma.report.findUnique({ where: { reference: params.reference } });
  if (!report) throw new AuthorizationError("ما لگينا هذا البلاغ.", "not-found");

  if (report.userId === params.sender.id) {
    throw new MessagingError("ما تگدر تراسل نفسك.", "own-report");
  }
  if (report.moderation !== "VISIBLE") {
    throw new AuthorizationError("ما لگينا هذا البلاغ.", "not-found");
  }

  const limit = await consumeRateLimit("messageSend", params.sender.id);
  if (!limit.allowed) throw new MessagingError("رسائل كثيرة. حاول بعد شوي.", "rate-limited");

  const conversation = await prisma.conversation.upsert({
    where: {
      reportId_initiatorId: { reportId: report.id, initiatorId: params.sender.id },
    },
    create: {
      reportId: report.id,
      ownerId: report.userId,
      initiatorId: params.sender.id,
      matchId: params.matchId ?? null,
    },
    update: {},
  });

  await appendMessage({ conversationId: conversation.id, sender: params.sender, body: params.body });
  return conversation;
}

export async function appendMessage(params: {
  conversationId: string;
  sender: User;
  body: string;
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: { report: { select: { reference: true, id: true } } },
  });

  if (!conversation) throw new AuthorizationError("ما لگينا المحادثة.", "not-found");

  const isParticipant =
    conversation.ownerId === params.sender.id || conversation.initiatorId === params.sender.id;
  if (!isParticipant) throw new AuthorizationError("ما لگينا المحادثة.", "not-found");

  if (conversation.status !== "OPEN") {
    throw new MessagingError("هذه المحادثة مغلقة.", "closed");
  }

  const limit = await consumeRateLimit("messageSend", params.sender.id);
  if (!limit.allowed) throw new MessagingError("رسائل كثيرة. حاول بعد شوي.", "rate-limited");

  const warned = containsPhoneNumber(params.body);

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: conversation.id, senderId: params.sender.id, body: params.body, warned },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  const recipientId =
    conversation.ownerId === params.sender.id ? conversation.initiatorId : conversation.ownerId;

  await notifyOnce(
    {
      userId: recipientId,
      type: "MESSAGE_RECEIVED",
      conversationId: conversation.id,
      reportId: conversation.report.id,
      payload: { reference: conversation.report.reference },
    },
    // One "you have messages" notification per thread per 15 minutes; the
    // thread itself carries the detail.
    15,
  );

  return { message, warned };
}

export async function listConversations(userId: string) {
  return prisma.conversation.findMany({
    where: { OR: [{ ownerId: userId }, { initiatorId: userId }] },
    orderBy: { lastMessageAt: "desc" },
    include: {
      report: {
        include: {
          category: true,
          images: { orderBy: { position: "asc" }, take: 1 },
        },
      },
      owner: { select: { id: true, displayName: true } },
      initiator: { select: { id: true, displayName: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: {
        select: {
          messages: { where: { readAt: null, senderId: { not: userId } } },
        },
      },
    },
  });
}

export async function listMessages(conversationId: string, viewerId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  // Reading the thread marks the other side's messages as read.
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: viewerId }, readAt: null },
    data: { readAt: new Date() },
  });

  return messages;
}

export async function unreadMessageCount(userId: string): Promise<number> {
  return prisma.message.count({
    where: {
      readAt: null,
      senderId: { not: userId },
      conversation: { OR: [{ ownerId: userId }, { initiatorId: userId }] },
    },
  });
}
