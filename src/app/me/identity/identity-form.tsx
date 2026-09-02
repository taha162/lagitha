"use client";

import { useActionState, useRef, useState } from "react";
import { Check, IdCard, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { submitIdentityAction } from "@/app/actions/identity";

/**
 * Uploading both sides of the national ID card.
 *
 * The two file inputs are hidden behind labelled buttons rather than shown raw:
 * a bare `<input type="file">` renders in the browser's own language, which on
 * a phone set to English puts "Choose file" in the middle of an Arabic form.
 *
 * No preview is rendered. Every other upload in this product shows the person
 * what they picked; here, putting an ID card on screen invites a screenshot,
 * and the file name plus a tick is enough to confirm the right side was chosen.
 */
export function IdentityForm({ defaultCardName }: { defaultCardName?: string }) {
  const [state, action, pending] = useActionState(submitIdentityAction, undefined);

  return (
    <form action={action} className="space-y-6">
      <TextField
        name="cardName"
        label={ar.identity.cardNameLabel}
        hint={ar.identity.cardNameHint}
        defaultValue={defaultCardName}
        maxLength={80}
        autoComplete="name"
        error={state && !state.ok && state.field === "cardName" ? state.error : undefined}
        required
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <SidePicker name="front" label={ar.identity.frontLabel} />
        <SidePicker name="back" label={ar.identity.backLabel} />
      </div>

      <p className="text-fine text-muted leading-relaxed">{ar.identity.coverNumbersHint}</p>

      {state && !state.ok && state.field !== "cardName" && (
        <p role="alert" className="text-meta text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {ar.identity.submitting}
          </>
        ) : (
          ar.identity.submit
        )}
      </Button>
    </form>
  );
}

function SidePicker({ name, label }: { name: "front" | "back"; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState(false);

  return (
    <div className="space-y-2">
      <p className="text-meta font-medium text-text">{label}</p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={[
          "w-full h-28 rounded-md border border-dashed grid place-items-center gap-1.5",
          "transition-colors text-meta",
          chosen
            ? "border-success bg-success-soft text-success"
            : "border-border-strong bg-surface text-muted hover:border-primary hover:text-primary",
        ].join(" ")}
      >
        {chosen ? (
          <>
            <Check className="size-6" aria-hidden />
            {ar.identity.fileChosen}
          </>
        ) : (
          <>
            <IdCard className="size-6" aria-hidden />
            {ar.identity.chooseFile}
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => setChosen(Boolean(event.target.files?.length))}
        required
      />
    </div>
  );
}
