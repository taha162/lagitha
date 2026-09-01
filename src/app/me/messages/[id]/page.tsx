import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { ar } from "@/i18n/ar";
import { AuthorizationError, requireUserPage, loadConversationForViewer } from "@/lib/authz";
import { listMessages } from "@/lib/services/messaging";
import { recoveryForReport } from "@/lib/services/recovery";
import { formatTime, relativeTime } from "@/lib/time";
import { ReportTypeBadge } from "@/components/ui/badge";
import { MessageComposer } from "./composer";
import { RecoveryPrompt } from "./recovery-prompt";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: ar.messages.title,
  robots: { index: false, follow: false },
};

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserPage(`/me/messages/${id}`);

  let conversation;
  try {
    conversation = await loadConversationForViewer(id, user);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  const [messages, recovery] = await Promise.all([
    listMessages(conversation.id, user.id),
    recoveryForReport(conversation.reportId, user.id),
  ]);

  const other = conversation.ownerId === user.id ? conversation.initiator : conversation.owner;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="sticky top-0 z-20 bg-background border-b border-border">
        <div className="mx-auto max-w-2xl px-4 h-14 flex items-center gap-3">
          <Link
            href="/me/messages"
            aria-label={ar.errors.goBack}
            className="-ms-2 size-9 grid place-items-center rounded-sm text-muted hover:text-text hover:bg-surface-sunken transition-colors"
          >
            <ArrowRight className="size-5" aria-hidden />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="text-h3 text-text-strong truncate">{other.displayName}</p>
            <Link
              href={`/r/${conversation.report.reference}`}
              className="flex items-center gap-1.5 text-fine text-muted hover:text-primary transition-colors"
            >
              <span className="truncate">
                {ar.messages.aboutReport}: {conversation.report.title}
              </span>
            </Link>
          </div>

          <ReportTypeBadge type={conversation.report.type} />
        </div>
      </header>

      <main id="main" className="flex-1 mx-auto w-full max-w-2xl px-4 py-4 pb-40">
        <p className="mb-4 flex items-start gap-2 text-fine text-muted bg-surface-sunken border border-border rounded-md px-3 py-2.5">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" aria-hidden strokeWidth={1.75} />
          {ar.messages.safetyNote}
        </p>

        {recovery && !recovery.completedAt && (
          <RecoveryPrompt
            recoveryId={recovery.id}
            alreadyConfirmed={Boolean(
              (recovery.ownerId === user.id && recovery.ownerConfirmedAt) ||
                (recovery.finderId === user.id && recovery.finderConfirmedAt),
            )}
            isOwner={recovery.ownerId === user.id}
          />
        )}

        <ol className="space-y-2.5">
          {messages.map((message) => {
            const mine = message.senderId === user.id;
            return (
              <li
                key={message.id}
                className={cn("flex flex-col", mine ? "items-start" : "items-end")}
              >
                <div
                  className={cn(
                    "max-w-[85%] px-3.5 py-2.5 rounded-lg text-body leading-relaxed whitespace-pre-wrap break-words",
                    mine
                      ? "bg-primary text-primary-contrast rounded-ss-sm"
                      : "bg-surface border border-border text-text rounded-se-sm",
                  )}
                >
                  {message.body}
                </div>
                <span className="mt-0.5 px-1 text-fine text-muted">
                  {formatTime(message.createdAt)}
                </span>
                {message.warned && mine && (
                  <span className="px-1 text-fine text-warning">{ar.messages.phoneWarning}</span>
                )}
              </li>
            );
          })}
        </ol>

        {messages.length === 0 && (
          <p className="text-center text-meta text-muted py-8">{ar.messages.empty}</p>
        )}

        <p className="mt-6 text-center text-fine text-muted">
          {relativeTime(conversation.createdAt)}
        </p>
      </main>

      {conversation.status === "OPEN" ? (
        <MessageComposer conversationId={conversation.id} />
      ) : (
        <footer className="fixed inset-x-0 bottom-0 bg-surface border-t border-border px-4 py-4 text-center text-meta text-muted">
          {ar.messages.closed}
        </footer>
      )}
    </div>
  );
}
