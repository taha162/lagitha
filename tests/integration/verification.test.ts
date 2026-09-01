import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  answerVisibility,
  commitFinderSecret,
  createVerificationRequest,
  decideVerification,
  VerificationError,
} from "@/lib/services/verification";
import { AuthorizationError } from "@/lib/authz";
import { createReportFixture, createUser, resetDatabase, testDb } from "../helpers/db";

/**
 * The rule these tests exist to protect: a finder must commit their own
 * expected answer before they are shown the claimant's. Without that ordering,
 * "prove it's yours" is theatre — the finder could read the answer and then
 * decide whether it was right.
 */
const SECRET = "الخلفية صورة ولد صغير وبالكفر ورقة";
const ANSWER = "خلفية الشاشة صورة ولدي، وبالكفر ورقة صغيرة";

beforeAll(resetDatabase);
beforeEach(resetDatabase);

describe("createVerificationRequest", () => {
  it("records a claim against a found report", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: SECRET,
    });

    const request = await createVerificationRequest({
      claimant,
      reference: report.reference,
      answer: ANSWER,
    });

    expect(request.status).toBe("PENDING");
    expect(request.answer).toBe(ANSWER);
  });

  it("freezes the finder's secret at the moment the claim is filed", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: SECRET,
    });

    const request = await createVerificationRequest({
      claimant,
      reference: report.reference,
      answer: ANSWER,
    });

    // The finder edits their secret afterwards — the claim keeps the original,
    // so the goalposts cannot be moved after seeing who is asking.
    await testDb.report.update({
      where: { id: report.id },
      data: { verificationSecret: "شيء مختلف تماماً" },
    });

    const stored = await testDb.verificationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(stored.finderSecretSnapshot).toBe(SECRET);
  });

  it("parks the claim when the finder has not set a secret yet", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: null,
    });

    const request = await createVerificationRequest({
      claimant,
      reference: report.reference,
      answer: ANSWER,
    });

    expect(request.status).toBe("AWAITING_FINDER_SECRET");
    expect(answerVisibility(request).visible).toBe(false);
  });

  it("refuses a claim on your own report", async () => {
    const finder = await createUser();
    const report = await createReportFixture({ userId: finder.id, type: "FOUND" });

    await expect(
      createVerificationRequest({ claimant: finder, reference: report.reference, answer: ANSWER }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("refuses a second claim on the same report from the same person", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: SECRET,
    });

    await createVerificationRequest({ claimant, reference: report.reference, answer: ANSWER });
    await expect(
      createVerificationRequest({ claimant, reference: report.reference, answer: "محاولة ثانية" }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("refuses a claim on a hidden report", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      moderation: "HIDDEN",
    });

    await expect(
      createVerificationRequest({ claimant, reference: report.reference, answer: ANSWER }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("refuses a claim against a reference that does not exist", async () => {
    const claimant = await createUser();
    await expect(
      createVerificationRequest({ claimant, reference: "LG-NOPE99", answer: ANSWER }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("notifies the finder", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: SECRET,
    });

    await createVerificationRequest({ claimant, reference: report.reference, answer: ANSWER });

    const notification = await testDb.notification.findFirstOrThrow({
      where: { userId: finder.id, type: "VERIFICATION_REQUESTED" },
    });
    expect(notification.reportId).toBe(report.id);
  });
});

describe("answerVisibility — the commit-first rule", () => {
  it("withholds the answer until the finder has committed a secret", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: null,
    });

    const request = await createVerificationRequest({
      claimant,
      reference: report.reference,
      answer: ANSWER,
    });

    expect(answerVisibility(request).visible).toBe(false);
    expect(answerVisibility(request).similarity).toBeNull();
  });

  it("reveals it once they have, along with an advisory similarity", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: null,
    });

    await createVerificationRequest({ claimant, reference: report.reference, answer: ANSWER });

    const pending = await testDb.verificationRequest.findFirstOrThrow({});
    const committed = await commitFinderSecret({
      finder,
      requestId: pending.id,
      secret: SECRET,
    });

    const visibility = answerVisibility(committed);
    expect(visibility.visible).toBe(true);
    expect(visibility.similarity).toBeGreaterThan(0);
    expect(visibility.similarity).toBeLessThanOrEqual(1);
  });
});

describe("commitFinderSecret", () => {
  it("moves every waiting claim on the report to reviewable, pinned to one secret", async () => {
    const finder = await createUser();
    const first = await createUser();
    const second = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: null,
    });

    await createVerificationRequest({ claimant: first, reference: report.reference, answer: "جواب أول" });
    await createVerificationRequest({ claimant: second, reference: report.reference, answer: "جواب ثاني" });

    const anyRequest = await testDb.verificationRequest.findFirstOrThrow({});
    await commitFinderSecret({ finder, requestId: anyRequest.id, secret: SECRET });

    const all = await testDb.verificationRequest.findMany({ where: { reportId: report.id } });
    expect(all).toHaveLength(2);
    for (const request of all) {
      expect(request.status).toBe("PENDING");
      expect(request.finderSecretSnapshot).toBe(SECRET);
    }
  });

  it("refuses anyone other than the report's author", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const stranger = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: null,
    });

    await createVerificationRequest({ claimant, reference: report.reference, answer: ANSWER });
    const request = await testDb.verificationRequest.findFirstOrThrow({});

    await expect(
      commitFinderSecret({ finder: stranger, requestId: request.id, secret: "تخمين" }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // The claimant themselves is not allowed to set it either.
    await expect(
      commitFinderSecret({ finder: claimant, requestId: request.id, secret: ANSWER }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("decideVerification", () => {
  async function arrange() {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: SECRET,
    });
    const request = await createVerificationRequest({
      claimant,
      reference: report.reference,
      answer: ANSWER,
    });
    return { finder, claimant, report, request };
  }

  it("accepts a claim and opens a private channel between the two", async () => {
    const { finder, claimant, report, request } = await arrange();

    await decideVerification({ decider: finder, requestId: request.id, decision: "ACCEPTED" });

    const updated = await testDb.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(updated.status).toBe("ACCEPTED");
    expect(updated.decidedById).toBe(finder.id);

    const conversation = await testDb.conversation.findFirstOrThrow({
      where: { reportId: report.id },
    });
    expect(conversation.ownerId).toBe(finder.id);
    expect(conversation.initiatorId).toBe(claimant.id);
  });

  it("rejects a claim without opening a channel", async () => {
    const { finder, report, request } = await arrange();

    await decideVerification({ decider: finder, requestId: request.id, decision: "REJECTED" });

    expect(await testDb.conversation.count({ where: { reportId: report.id } })).toBe(0);
  });

  it("notifies the claimant either way", async () => {
    const { finder, claimant, request } = await arrange();

    await decideVerification({ decider: finder, requestId: request.id, decision: "ACCEPTED" });

    await testDb.notification.findFirstOrThrow({
      where: { userId: claimant.id, type: "VERIFICATION_ACCEPTED" },
    });
  });

  it("refuses a stranger", async () => {
    const { request } = await arrange();
    const stranger = await createUser();

    await expect(
      decideVerification({ decider: stranger, requestId: request.id, decision: "ACCEPTED" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets staff decide, for dispute resolution", async () => {
    const { request } = await arrange();
    const moderator = await createUser({ role: "MODERATOR" });

    await expect(
      decideVerification({ decider: moderator, requestId: request.id, decision: "REJECTED" }),
    ).resolves.toBeTruthy();
  });

  it("refuses to decide twice", async () => {
    const { finder, request } = await arrange();

    await decideVerification({ decider: finder, requestId: request.id, decision: "ACCEPTED" });
    await expect(
      decideVerification({ decider: finder, requestId: request.id, decision: "REJECTED" }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("refuses to decide before the secret is committed", async () => {
    const finder = await createUser();
    const claimant = await createUser();
    const report = await createReportFixture({
      userId: finder.id,
      type: "FOUND",
      verificationSecret: null,
    });
    const request = await createVerificationRequest({
      claimant,
      reference: report.reference,
      answer: ANSWER,
    });

    await expect(
      decideVerification({ decider: finder, requestId: request.id, decision: "ACCEPTED" }),
    ).rejects.toBeInstanceOf(VerificationError);
  });
});
