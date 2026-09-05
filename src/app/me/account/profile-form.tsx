"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { Field, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { completeProfileAction, updateHomeAreaAction } from "@/app/actions/auth";

/**
 * Name and neighbourhood.
 *
 * Two separate forms rather than one "save everything" button: they are
 * unrelated edits, and one failing should not discard the other. Each save
 * button stays disabled until its own field actually changed, so the page
 * never invites a no-op write.
 */
export function ProfileForm({
  displayName,
  areaSlug,
  areas,
}: {
  displayName: string;
  areaSlug: string | null;
  areas: { slug: string; nameAr: string }[];
}) {
  return (
    <div className="space-y-5">
      <NameForm displayName={displayName} />
      <AreaForm areaSlug={areaSlug} areas={areas} />
    </div>
  );
}

function NameForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(completeProfileAction, undefined);
  const [name, setName] = useState(displayName);

  useEffect(() => {
    if (state?.ok) {
      toast(ar.account.saved, "success");
      router.refresh();
    }
  }, [state, toast, router]);

  const changed = name.trim() !== displayName && name.trim().length > 0;

  return (
    <form action={action} className="space-y-2.5">
      <TextField
        name="displayName"
        label={ar.account.displayName}
        hint={ar.signup.nameHint}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        error={state && !state.ok ? state.error : undefined}
        required
      />
      <SaveButton pending={pending} disabled={!changed} />
    </form>
  );
}

function AreaForm({
  areaSlug,
  areas,
}: {
  areaSlug: string | null;
  areas: { slug: string; nameAr: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(updateHomeAreaAction, undefined);
  const [slug, setSlug] = useState(areaSlug ?? "");

  useEffect(() => {
    if (state?.ok) {
      toast(ar.account.saved, "success");
      router.refresh();
    }
  }, [state, toast, router]);

  return (
    <form action={action} className="space-y-2.5">
      <Field label={ar.account.areaEdit} hint={ar.signup.locationHint}>
        {({ id, describedBy }) => (
          <select
            id={id}
            name="areaSlug"
            aria-describedby={describedBy}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className="w-full h-11 rounded-md border border-border-strong bg-surface px-3 text-body text-text transition-colors focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="">{ar.account.areaChoose}</option>
            {areas.map((area) => (
              <option key={area.slug} value={area.slug}>
                {area.nameAr}
              </option>
            ))}
          </select>
        )}
      </Field>
      <SaveButton pending={pending} disabled={slug === (areaSlug ?? "")} />
    </form>
  );
}

/** Shared so both forms report progress and completion identically. */
function SaveButton({ pending, disabled }: { pending: boolean; disabled: boolean }) {
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? (
        <>
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {ar.common.loading}
        </>
      ) : (
        <>
          <Check className="size-4" aria-hidden />
          {ar.account.save}
        </>
      )}
    </Button>
  );
}
