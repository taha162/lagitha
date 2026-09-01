"use server";

import { revalidatePath } from "next/cache";
import { ar } from "@/i18n/ar";
import { AuthorizationError, requireUser } from "@/lib/authz";
import {
  appendMessage,
  MessagingError,
  startConversation,
} from "@/lib/services/messaging";
import { confirmRecovery } from "@/lib/services/recovery";
import { markAllRead, markRead } from "@/lib/services/notifications";
import { sendMessageSchema, startConversationSchema } from "@/lib/validation";
import type { ActionResult } from "./auth";

export async function startConversationAction(
  input: unknown,
): Promise<ActionResult<{ conversationId: string }>> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: ar.errors.unauthorized };
  }

  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "body",
    };
  }

  try {
    const conversation = await startConversation({
      sender: user,
      reference: parsed.data.reference,
      body: parsed.data.body,
      matchId: parsed.data.matchId,
    });

    revalidatePath("/me/messages");
    return { ok: true, data: { conversationId: conversation.id } };
  } catch (error) {
    if (error instanceof MessagingError) return { ok: false, error: error.message };
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("startConversationAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function sendMessageAction(
  input: unknown,
): Promise<ActionResult<{ warned: boolean }>> {
  const user = await requireUser();
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? ar.errors.validation,
      field: "body",
    };
  }

  try {
    const { warned } = await appendMessage({
      conversationId: parsed.data.conversationId,
      sender: user,
      body: parsed.data.body,
    });

    revalidatePath(`/me/messages/${parsed.data.conversationId}`);
    revalidatePath("/me/messages");
    return { ok: true, data: { warned } };
  } catch (error) {
    if (error instanceof MessagingError) return { ok: false, error: error.message };
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("sendMessageAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function confirmRecoveryAction(
  recoveryId: string,
): Promise<ActionResult<{ completed: boolean }>> {
  const user = await requireUser();

  try {
    const result = await confirmRecovery({ recoveryId, user });
    revalidatePath("/me/reports");
    revalidatePath("/me/messages");
    return { ok: true, data: { completed: result.state === "completed" } };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("confirmRecoveryAction", error);
    return { ok: false, error: ar.errors.generic };
  }
}

export async function markNotificationsReadAction(id?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (id) await markRead(user.id, id);
  else await markAllRead(user.id);

  revalidatePath("/me/notifications");
  revalidatePath("/", "layout");
  return { ok: true };
}
