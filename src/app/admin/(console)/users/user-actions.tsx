"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { deleteUserAction, userActionAction } from "@/app/actions/admin";
import { DeleteDialog } from "@/components/admin/delete-dialog";

/**
 * Account-level actions.
 *
 * A written reason is mandatory — these are decisions about a person, and the
 * audit log has to say why, not just what. The server enforces it too.
 */
type Action = "suspend" | "unsuspend" | "ban" | "promote-moderator" | "demote";

export function UserActions({
  userId,
  displayName,
  role,
  status,
}: {
  userId: string;
  displayName: string;
  role: string;
  status: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!pendingAction) return;

    setBusy(true);
    setError(null);
    const result = await userActionAction({
      userId,
      action: pendingAction,
      reason: reason.trim(),
      days: pendingAction === "suspend" ? Number.parseInt(days, 10) || 7 : undefined,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast(ar.admin.actions.done, "success");
    setPendingAction(null);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <div className="flex gap-1.5 whitespace-nowrap">
        {status === "ACTIVE" ? (
          <Button size="sm" variant="ghost" onClick={() => setPendingAction("suspend")}>
            {ar.admin.actions.suspendUser}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setPendingAction("unsuspend")}>
            {ar.admin.actions.unsuspendUser}
          </Button>
        )}

        {role === "MEMBER" ? (
          <Button size="sm" variant="ghost" onClick={() => setPendingAction("promote-moderator")}>
            {ar.admin.actions.makeModerator}
          </Button>
        ) : role === "MODERATOR" ? (
          <Button size="sm" variant="ghost" onClick={() => setPendingAction("demote")}>
            {ar.admin.actions.demote}
          </Button>
        ) : null}

        {status !== "BANNED" && (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:bg-danger-soft"
            onClick={() => setPendingAction("ban")}
          >
            {ar.admin.actions.banUser}
          </Button>
        )}

        {/* Banning keeps the record and stops the person; this is for when the
            content itself has to go, so it sits behind its own confirmation. */}
        {role !== "ADMIN" && (
          <DeleteDialog
            label={ar.admin.actions.delete}
            title={ar.admin.actions.deleteUser}
            body={ar.admin.actions.deleteUserConfirm}
            confirmWord={displayName}
            onDelete={({ confirm, reason }) =>
              deleteUserAction({ id: userId, confirm, reason })
            }
          />
        )}
      </div>

      <Sheet
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        variant="dialog"
        title={displayName}
        description={ar.admin.actions.reasonRequired}
        footer={
          <div className="flex gap-2">
            <Button block onClick={confirm} disabled={busy || reason.trim().length < 3}>
              {ar.common.confirm}
            </Button>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>
              {ar.common.cancel}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TextField
            label={ar.admin.actions.reasonLabel}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            error={error ?? undefined}
            required
            autoFocus
          />

          {pendingAction === "suspend" && (
            <TextField
              type="number"
              min={1}
              max={365}
              label="مدة الإيقاف (أيام)"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="latin"
            />
          )}
        </div>
      </Sheet>
    </>
  );
}
