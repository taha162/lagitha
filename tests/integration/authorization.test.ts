import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  canAccessConversation,
  canDecideVerification,
  canEditReport,
  canModerate,
  canViewReport,
  canViewVerification,
  isAdmin,
  isStaff,
  loadConversationForViewer,
  loadEditableReport,
  loadViewableReport,
} from "@/lib/authz";
import { appendMessage, startConversation } from "@/lib/services/messaging";
import { createReportFixture, createUser, resetDatabase, testDb } from "../helpers/db";

/**
 * The negative tests. Each one is an attempt to reach something the actor
 * should not be able to reach.
 */
beforeAll(resetDatabase);
beforeEach(resetDatabase);

describe("role predicates", () => {
  it("distinguishes members, moderators and admins", () => {
    expect(isStaff({ role: "MEMBER" })).toBe(false);
    expect(isStaff({ role: "MODERATOR" })).toBe(true);
    expect(isStaff({ role: "ADMIN" })).toBe(true);

    expect(isAdmin({ role: "MODERATOR" })).toBe(false);
    expect(isAdmin({ role: "ADMIN" })).toBe(true);

    expect(isStaff(null)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(canModerate(null)).toBe(false);
  });
});

describe("report visibility", () => {
  const hidden = { id: "r1", userId: "owner", moderation: "HIDDEN", status: "ACTIVE" };
  const visible = { id: "r2", userId: "owner", moderation: "VISIBLE", status: "ACTIVE" };

  it("lets anyone read a visible report", () => {
    expect(canViewReport(visible, null)).toBe(true);
  });

  it("hides a hidden report from the public", () => {
    expect(canViewReport(hidden, null)).toBe(false);
    expect(canViewReport(hidden, { id: "stranger", role: "MEMBER" })).toBe(false);
  });

  it("still shows the author their own hidden report", () => {
    expect(canViewReport(hidden, { id: "owner", role: "MEMBER" })).toBe(true);
  });

  it("shows staff everything", () => {
    expect(canViewReport(hidden, { id: "mod", role: "MODERATOR" })).toBe(true);
  });
});

describe("report editing", () => {
  const report = { id: "r1", userId: "owner", moderation: "VISIBLE", status: "ACTIVE" };

  it("allows the author", () => {
    expect(canEditReport(report, { id: "owner", role: "MEMBER" })).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canEditReport(report, { id: "stranger", role: "MEMBER" })).toBe(false);
    expect(canEditReport(report, null)).toBe(false);
  });

  it("refuses the author once the report is recovered", () => {
    expect(
      canEditReport({ ...report, status: "RECOVERED" }, { id: "owner", role: "MEMBER" }),
    ).toBe(false);
  });
});

describe("loadViewableReport", () => {
  it("hands a visible report to a signed-out visitor", async () => {
    const owner = await createUser();
    const report = await createReportFixture({ userId: owner.id });

    const loaded = await loadViewableReport(report.reference, null);
    expect(loaded.id).toBe(report.id);
  });

  it("reports a hidden report as not-found, not as forbidden", async () => {
    // A 403 would confirm the report exists, which is itself a leak.
    const owner = await createUser();
    const stranger = await createUser();
    const report = await createReportFixture({ userId: owner.id, moderation: "HIDDEN" });

    await expect(loadViewableReport(report.reference, stranger)).rejects.toMatchObject({
      kind: "not-found",
    });
  });

  it("reports an unknown reference as not-found", async () => {
    await expect(loadViewableReport("LG-NOPE99", null)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("loadEditableReport", () => {
  it("refuses a stranger", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const report = await createReportFixture({ userId: owner.id });

    await expect(loadEditableReport(report.reference, stranger)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  it("allows the author", async () => {
    const owner = await createUser();
    const report = await createReportFixture({ userId: owner.id });

    await expect(loadEditableReport(report.reference, owner)).resolves.toBeTruthy();
  });
});

describe("conversations", () => {
  it("admits only the two participants", () => {
    const conversation = { initiatorId: "a", ownerId: "b" };

    expect(canAccessConversation(conversation, { id: "a", role: "MEMBER" })).toBe(true);
    expect(canAccessConversation(conversation, { id: "b", role: "MEMBER" })).toBe(true);
    expect(canAccessConversation(conversation, { id: "c", role: "MEMBER" })).toBe(false);
    expect(canAccessConversation(conversation, null)).toBe(false);
  });

  it("does not silently admit staff either", () => {
    // Staff moderating a thread is an audited action, not an ambient power.
    expect(canAccessConversation({ initiatorId: "a", ownerId: "b" }, { id: "mod", role: "ADMIN" })).toBe(
      false,
    );
  });

  it("refuses to load a thread for a third party", async () => {
    const owner = await createUser();
    const sender = await createUser();
    const stranger = await createUser();
    const report = await createReportFixture({ userId: owner.id, type: "FOUND" });

    const conversation = await startConversation({
      sender,
      reference: report.reference,
      body: "لگيت شيء يشبه اللي ضاع مني",
    });

    await expect(loadConversationForViewer(conversation.id, stranger)).rejects.toMatchObject({
      kind: "not-found",
    });
    await expect(loadConversationForViewer(conversation.id, owner)).resolves.toBeTruthy();
    await expect(loadConversationForViewer(conversation.id, sender)).resolves.toBeTruthy();
  });

  it("refuses a message from someone outside the thread", async () => {
    const owner = await createUser();
    const sender = await createUser();
    const stranger = await createUser();
    const report = await createReportFixture({ userId: owner.id, type: "FOUND" });

    const conversation = await startConversation({
      sender,
      reference: report.reference,
      body: "سلام",
    });

    await expect(
      appendMessage({ conversationId: conversation.id, sender: stranger, body: "أنا مو طرف" }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(await testDb.message.count({ where: { conversationId: conversation.id } })).toBe(1);
  });

  it("refuses to start a thread on your own report", async () => {
    const owner = await createUser();
    const report = await createReportFixture({ userId: owner.id, type: "FOUND" });

    await expect(
      startConversation({ sender: owner, reference: report.reference, body: "مرحبا" }),
    ).rejects.toThrow();
  });

  it("refuses to start a thread on a hidden report", async () => {
    const owner = await createUser();
    const sender = await createUser();
    const report = await createReportFixture({ userId: owner.id, moderation: "HIDDEN" });

    await expect(
      startConversation({ sender, reference: report.reference, body: "مرحبا" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("reuses one thread per person per report", async () => {
    const owner = await createUser();
    const sender = await createUser();
    const report = await createReportFixture({ userId: owner.id, type: "FOUND" });

    const first = await startConversation({ sender, reference: report.reference, body: "رسالة ١" });
    const second = await startConversation({ sender, reference: report.reference, body: "رسالة ٢" });

    expect(second.id).toBe(first.id);
    expect(await testDb.conversation.count()).toBe(1);
    expect(await testDb.message.count()).toBe(2);
  });

  it("flags a message containing a phone number without blocking it", async () => {
    const owner = await createUser();
    const sender = await createUser();
    const report = await createReportFixture({ userId: owner.id, type: "FOUND" });

    const conversation = await startConversation({
      sender,
      reference: report.reference,
      body: "سلام",
    });
    const { warned } = await appendMessage({
      conversationId: conversation.id,
      sender,
      body: "اتصل بي على 07701234567",
    });

    expect(warned).toBe(true);
    // Flagged, but delivered — we warn, we do not censor.
    expect(await testDb.message.count({ where: { conversationId: conversation.id } })).toBe(2);
  });
});

describe("verification access", () => {
  const request = { claimantId: "claimant", report: { userId: "finder" } };

  it("lets the finder and staff decide, and nobody else", () => {
    expect(canDecideVerification(request, { id: "finder", role: "MEMBER" })).toBe(true);
    expect(canDecideVerification(request, { id: "mod", role: "MODERATOR" })).toBe(true);
    expect(canDecideVerification(request, { id: "claimant", role: "MEMBER" })).toBe(false);
    expect(canDecideVerification(request, null)).toBe(false);
  });

  it("lets both parties and staff read it", () => {
    expect(canViewVerification(request, { id: "claimant", role: "MEMBER" })).toBe(true);
    expect(canViewVerification(request, { id: "finder", role: "MEMBER" })).toBe(true);
    expect(canViewVerification(request, { id: "stranger", role: "MEMBER" })).toBe(false);
  });
});
