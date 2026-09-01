import "server-only";
import type { User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { AuthorizationError } from "../authz";
import { textSimilarity } from "../arabic";
import { consumeRateLimit } from "../rate-limit";
import { notify } from "./notifications";

/**
 * Ownership verification.
 *
 * The rule the whole flow exists to enforce: nobody gets an item because they
 * said it was theirs. A claimant must describe something that was never
 * published, and — the part that actually makes it fair — the finder has to
 * commit their own expected answer *before* they are shown the claimant's.
 *
 * Without that ordering a finder could read the answer and then "remember"
 * that it was right (or wrong). With it, both sides are locked in and the
 * comparison is honest. A snapshot of the finder's secret is stored on the
 * request so a later edit cannot move the goalposts either.
 */

export class VerificationError extends Error {
  constructor(
    override readonly message: string,
    readonly code: "own-report" | "duplicate" | "rate-limited" | "not-claimable",
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

export async function createVerificationRequest(params: {
  claimant: User;
  reference: string;
  answer: string;
  matchId?: string;
}) {
  const report = await prisma.report.findUnique({
    where: { reference: params.reference },
    include: { user: { select: { id: true } } },
  });

  if (!report) throw new AuthorizationError("ما لگينا هذا البلاغ.", "not-found");
  if (report.userId === params.claimant.id) {
    throw new VerificationError("ما تگدر تطلب إثبات ملكية على بلاغك.", "own-report");
  }
  if (report.moderation !== "VISIBLE" || report.status !== "ACTIVE") {
    throw new VerificationError("هذا البلاغ ما يقبل طلبات حالياً.", "not-claimable");
  }

  const limit = await consumeRateLimit("verificationClaim", params.claimant.id);
  if (!limit.allowed) {
    throw new VerificationError("طلبات كثيرة. حاول بعد شوي.", "rate-limited");
  }

  const existing = await prisma.verificationRequest.findUnique({
    where: { reportId_claimantId: { reportId: report.id, claimantId: params.claimant.id } },
  });
  if (existing) {
    throw new VerificationError("عندك طلب سابق على هذا البلاغ.", "duplicate");
  }

  // If the finder already recorded a secret detail, freeze it now. If not, the
  // request waits until they do — they still cannot see the answer first.
  const status = report.verificationSecret ? "PENDING" : "AWAITING_FINDER_SECRET";

  const request = await prisma.verificationRequest.create({
    data: {
      reportId: report.id,
      claimantId: params.claimant.id,
      matchId: params.matchId ?? null,
      answer: params.answer,
      finderSecretSnapshot: report.verificationSecret,
      status,
    },
  });

  await notify({
    userId: report.userId,
    type: "VERIFICATION_REQUESTED",
    reportId: report.id,
    verificationId: request.id,
    payload: { reference: report.reference, needsSecret: status === "AWAITING_FINDER_SECRET" },
  });

  return request;
}

/**
 * The finder commits their expected answer. Only after this does
 * `revealAnswerTo` return the claimant's text.
 */
export async function commitFinderSecret(params: {
  finder: User;
  requestId: string;
  secret: string;
}) {
  const request = await prisma.verificationRequest.findUnique({
    where: { id: params.requestId },
    include: { report: { select: { id: true, userId: true, verificationSecret: true } } },
  });

  if (!request) throw new AuthorizationError("ما لگينا الطلب.", "not-found");
  if (request.report.userId !== params.finder.id) {
    throw new AuthorizationError("ما عندك صلاحية على هذا الطلب.", "forbidden");
  }

  await prisma.$transaction([
    prisma.report.update({
      where: { id: request.reportId },
      data: { verificationSecret: params.secret },
    }),
    prisma.verificationRequest.update({
      where: { id: request.id },
      data: {
        finderSecretSnapshot: params.secret,
        status: request.status === "AWAITING_FINDER_SECRET" ? "PENDING" : request.status,
      },
    }),
    // Any other claim waiting on this report becomes reviewable too, each
    // pinned to the same secret.
    prisma.verificationRequest.updateMany({
      where: { reportId: request.reportId, status: "AWAITING_FINDER_SECRET" },
      data: { finderSecretSnapshot: params.secret, status: "PENDING" },
    }),
  ]);

  return prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
}

/**
 * Whether the finder may see the claimant's answer yet, and a *hint* at how
 * close the two texts are. The hint is advisory: the finder decides, not us.
 */
export function answerVisibility(request: {
  status: string;
  answer: string;
  finderSecretSnapshot: string | null;
}): { visible: boolean; similarity: number | null } {
  if (!request.finderSecretSnapshot || request.status === "AWAITING_FINDER_SECRET") {
    return { visible: false, similarity: null };
  }
  return {
    visible: true,
    similarity: textSimilarity(request.answer, request.finderSecretSnapshot),
  };
}

export async function decideVerification(params: {
  decider: User;
  requestId: string;
  decision: "ACCEPTED" | "REJECTED";
  note?: string;
}) {
  const request = await prisma.verificationRequest.findUnique({
    where: { id: params.requestId },
    include: { report: { select: { id: true, userId: true, reference: true, type: true } } },
  });

  if (!request) throw new AuthorizationError("ما لگينا الطلب.", "not-found");

  const isReportOwner = request.report.userId === params.decider.id;
  const isStaffMember = params.decider.role === "ADMIN" || params.decider.role === "MODERATOR";
  if (!isReportOwner && !isStaffMember) {
    throw new AuthorizationError("ما عندك صلاحية على هذا الطلب.", "forbidden");
  }
  if (request.status === "AWAITING_FINDER_SECRET") {
    throw new VerificationError("سجّل التفصيل المتوقع أول.", "not-claimable");
  }
  if (request.status !== "PENDING") {
    throw new VerificationError("تم البت في هذا الطلب سابقاً.", "duplicate");
  }

  const updated = await prisma.verificationRequest.update({
    where: { id: request.id },
    data: {
      status: params.decision,
      decidedAt: new Date(),
      decidedById: params.decider.id,
      decisionNote: params.note ?? null,
    },
  });

  await notify({
    userId: request.claimantId,
    type: params.decision === "ACCEPTED" ? "VERIFICATION_ACCEPTED" : "VERIFICATION_REJECTED",
    reportId: request.reportId,
    verificationId: request.id,
    payload: { reference: request.report.reference },
  });

  // An accepted claim opens a channel so the two can arrange a handover
  // without either of them publishing a phone number.
  if (params.decision === "ACCEPTED") {
    await ensureConversation({
      reportId: request.reportId,
      ownerId: request.report.userId,
      initiatorId: request.claimantId,
      matchId: request.matchId,
    });
  }

  return updated;
}

async function ensureConversation(params: {
  reportId: string;
  ownerId: string;
  initiatorId: string;
  matchId: string | null;
}) {
  const existing = await prisma.conversation.findUnique({
    where: {
      reportId_initiatorId: { reportId: params.reportId, initiatorId: params.initiatorId },
    },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      reportId: params.reportId,
      ownerId: params.ownerId,
      initiatorId: params.initiatorId,
      matchId: params.matchId,
    },
  });
}

export async function verificationsForReport(reportId: string) {
  return prisma.verificationRequest.findMany({
    where: { reportId },
    orderBy: { createdAt: "desc" },
    include: { claimant: { select: { id: true, displayName: true, createdAt: true } } },
  });
}

export async function verificationsByClaimant(claimantId: string) {
  return prisma.verificationRequest.findMany({
    where: { claimantId },
    orderBy: { createdAt: "desc" },
    include: {
      report: {
        include: {
          category: true,
          images: { orderBy: { position: "asc" }, take: 1 },
        },
      },
    },
  });
}

export async function countPendingClaims(reportIds: readonly string[]): Promise<Map<string, number>> {
  if (reportIds.length === 0) return new Map();

  const grouped = await prisma.verificationRequest.groupBy({
    by: ["reportId"],
    where: {
      reportId: { in: [...reportIds] },
      status: { in: ["PENDING", "AWAITING_FINDER_SECRET"] },
    },
    _count: { _all: true },
  });

  return new Map(grouped.map((row) => [row.reportId, row._count._all]));
}
