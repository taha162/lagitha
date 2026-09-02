"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, X } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateAvatarAction } from "@/app/actions/auth";

/**
 * Changing the profile photo from the account page.
 *
 * Picking a file submits immediately. A separate "save" step would be one more
 * thing to forget on a form whose only field is a picture.
 */
export function ProfilePhoto({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(updateAvatarAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast(ar.account.saved, "success");
      router.refresh();
    } else {
      toast(state.error, "error");
    }
  }, [state, toast, router]);

  return (
    <form ref={formRef} action={action} className="flex items-center gap-4">
      <Avatar url={avatarUrl} name={displayName} size="lg" />

      <div className="space-y-1.5">
        <p className="text-meta font-medium text-text">{ar.account.photo}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
          >
            {pending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                {ar.signup.photoUploading}
              </>
            ) : avatarUrl ? (
              ar.signup.photoChange
            ) : (
              ar.signup.photoChoose
            )}
          </Button>

          {avatarUrl && (
            <button
              type="submit"
              name="remove"
              value="1"
              disabled={pending}
              onClick={() => setRemoving(true)}
              className="flex items-center gap-1 text-fine text-muted hover:text-danger transition-colors"
            >
              <X className="size-3.5" aria-hidden />
              {removing && pending ? ar.common.loading : ar.signup.photoRemove}
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) formRef.current?.requestSubmit();
        }}
      />
    </form>
  );
}
