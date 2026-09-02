"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, LoaderCircle, MapPin, X } from "lucide-react";
import { ar } from "@/i18n/ar";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { Field, TextField } from "@/components/ui/field";
import { PasswordField } from "@/components/ui/password-field";
import { useRestoredForm } from "@/components/ui/use-restored-form";
import {
  completeSignupAction,
  profileSetupAction,
  startSignupAction,
} from "@/app/actions/auth";

/**
 * Creating an account, once.
 *
 * Three screens, in the order of what they cost the person: the things the
 * account cannot exist without (name, address, password), then proof that the
 * address is real, then the two things that only make the product nicer — a
 * photo and a neighbourhood — which can both be skipped.
 *
 * The password is never held in component state after the first step: it goes
 * to the server, is hashed there, and the browser keeps only the address.
 */
export interface AreaOption {
  slug: string;
  nameAr: string;
}

type Step =
  | { name: "account" }
  | { name: "code"; identifier: string; display: string; devDriver: boolean }
  | { name: "profile" };

const TOTAL_STEPS = 3;

export function SignupForm({
  next,
  channel,
  areas,
  startAtProfile,
}: {
  next: string;
  channel: "email" | "sms";
  areas: AreaOption[];
  /** True when the visitor already has a session — the account step is done. */
  startAtProfile: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(
    startAtProfile ? { name: "profile" } : { name: "account" },
  );

  const stepNumber = step.name === "account" ? 1 : step.name === "code" ? 2 : 3;

  return (
    <div className="space-y-5">
      <p className="text-fine text-muted">{ar.signup.step(stepNumber, TOTAL_STEPS)}</p>

      {step.name === "account" && (
        <AccountStep
          channel={channel}
          next={next}
          onSent={(data) => setStep({ name: "code", ...data })}
        />
      )}

      {step.name === "code" && (
        <CodeStep
          identifier={step.identifier}
          display={step.display}
          devDriver={step.devDriver}
          channel={channel}
          onBack={() => setStep({ name: "account" })}
          onCreated={() => setStep({ name: "profile" })}
        />
      )}

      {step.name === "profile" && (
        <ProfileStep
          areas={areas}
          onDone={() => {
            router.replace(next);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------- step one ----

function AccountStep({
  channel,
  next,
  onSent,
}: {
  channel: "email" | "sms";
  next: string;
  onSent: (data: { identifier: string; display: string; devDriver: boolean }) => void;
}) {
  const [state, action, pending] = useActionState(startSignupAction, undefined);
  // A rejected password must not take the name and the address down with it:
  // retyping all three because the confirmation had a typo is how people
  // abandon a sign-up.
  const formRef = useRestoredForm(state);

  useEffect(() => {
    if (state?.ok && state.data) onSent(state.data);
  }, [state, onSent]);

  const fieldError = (field: string) =>
    state && !state.ok && state.field === field ? state.error : undefined;

  return (
    <div className="space-y-6">
      <form ref={formRef} action={action} className="space-y-5">
        <div>
          <h1 className="text-h1 text-text-strong">{ar.signup.title}</h1>
          <p className="mt-1.5 text-meta text-muted">{ar.signup.subtitle}</p>
        </div>

        <TextField
          name="displayName"
          label={ar.signup.nameLabel}
          placeholder={ar.signup.namePlaceholder}
          hint={ar.signup.nameHint}
          autoComplete="name"
          maxLength={40}
          error={fieldError("displayName")}
          required
          autoFocus
        />

        <TextField
          name="identifier"
          type={channel === "email" ? "email" : "tel"}
          inputMode={channel === "email" ? "email" : "tel"}
          autoComplete={channel === "email" ? "email" : "tel"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          className="text-start latin"
          label={channel === "email" ? ar.signup.emailLabel : ar.auth.phoneLabel}
          placeholder={channel === "email" ? ar.auth.emailPlaceholder : ar.auth.phonePlaceholder}
          hint={channel === "email" ? ar.signup.emailHint : ar.auth.phoneHint}
          error={fieldError("identifier")}
          required
        />

        <PasswordField
          name="password"
          label={ar.signup.passwordLabel}
          hint={ar.signup.passwordHint(PASSWORD_MIN_LENGTH)}
          autoComplete="new-password"
          error={fieldError("password")}
        />

        <PasswordField
          name="passwordConfirm"
          label={ar.signup.passwordConfirmLabel}
          autoComplete="new-password"
          error={fieldError("passwordConfirm")}
        />

        {state && !state.ok && !state.field && (
          <p role="alert" className="text-meta text-danger">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.auth.sending}
            </>
          ) : (
            ar.signup.continue
          )}
        </Button>
      </form>

      <p className="text-center text-meta text-muted">
        {ar.auth.haveAccount}{" "}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="text-primary hover:text-primary-hover font-medium"
        >
          {ar.auth.signInInstead}
        </Link>
      </p>
    </div>
  );
}

// ------------------------------------------------------------- step two ----

function CodeStep({
  identifier,
  display,
  devDriver,
  channel,
  onBack,
  onCreated,
}: {
  identifier: string;
  display: string;
  devDriver: boolean;
  channel: "email" | "sms";
  onBack: () => void;
  onCreated: () => void;
}) {
  const [state, action, pending] = useActionState(completeSignupAction, undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state?.ok) onCreated();
  }, [state, onCreated]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="identifier" value={identifier} />

      <div>
        <h1 className="text-h1 text-text-strong">{ar.signup.codeTitle}</h1>
        <p className="mt-1.5 text-meta text-muted">
          {ar.signup.codeSubtitle("")}
          <span dir="ltr" className="latin"> {display}</span>
        </p>
        {channel === "email" && <p className="mt-2 text-fine text-muted">{ar.auth.checkSpam}</p>}
      </div>

      {devDriver && (
        <p className="text-fine text-warning bg-warning-soft border border-warning/25 rounded-sm px-3 py-2">
          {ar.auth.devCodeNotice}
        </p>
      )}

      <TextField
        ref={inputRef}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        className="text-center tracking-[0.4em] text-h1 latin"
        label={ar.auth.codeLabel}
        error={state && !state.ok ? state.error : undefined}
        required
      />

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {ar.auth.verifying}
          </>
        ) : (
          ar.signup.codeSubmit
        )}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-meta text-muted hover:text-text transition-colors"
      >
        <ArrowRight className="size-4" aria-hidden />
        {ar.auth.changeNumber}
      </button>
    </form>
  );
}

// ----------------------------------------------------------- step three ----

function ProfileStep({ areas, onDone }: { areas: AreaOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(profileSetupAction, undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  // An object URL is a resource, not a string: released when it is replaced.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function onPick(file: File | undefined) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
        setLocationDenied(false);
      },
      () => {
        setLocating(false);
        setLocationDenied(true);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  return (
    <form action={action} className="space-y-6">
      <div>
        <h1 className="text-h1 text-text-strong">{ar.signup.profileTitle}</h1>
        <p className="mt-1.5 text-meta text-muted leading-relaxed">{ar.signup.profileSubtitle}</p>
      </div>

      {/* ---- photo ---- */}
      <div className="space-y-2">
        <p className="text-meta font-medium text-text">
          {ar.signup.photoLabel}
          <span className="text-muted font-normal"> — {ar.common.optional}</span>
        </p>

        <div className="flex items-center gap-4">
          <div className="size-20 rounded-full bg-surface-sunken border border-border grid place-items-center overflow-hidden shrink-0">
            {preview ? (
              // Not next/image: this is a blob: URL that exists for one render.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <Camera className="size-6 text-muted" aria-hidden />
            )}
          </div>

          <div className="space-y-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              {preview ? ar.signup.photoChange : ar.signup.photoChoose}
            </Button>

            {preview && (
              <button
                type="button"
                onClick={() => {
                  if (fileRef.current) fileRef.current.value = "";
                  onPick(undefined);
                }}
                className="flex items-center gap-1 text-fine text-muted hover:text-danger transition-colors"
              >
                <X className="size-3.5" aria-hidden />
                {ar.signup.photoRemove}
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
          onChange={(event) => onPick(event.target.files?.[0])}
        />

        <p className="text-fine text-muted">{ar.signup.photoHint}</p>
        {state && !state.ok && state.field === "photo" && (
          <p role="alert" className="text-fine text-danger">
            {state.error}
          </p>
        )}
      </div>

      {/* ---- location ---- */}
      <div className="space-y-2">
        <input type="hidden" name="point" value={point ? JSON.stringify(point) : ""} />

        <Field label={ar.signup.locationLabel} hint={ar.signup.locationHint} optional>
          {({ id, describedBy }) => (
            <select
              id={id}
              name="areaSlug"
              aria-describedby={describedBy}
              disabled={point !== null}
              className="w-full h-11 bg-surface border border-border-strong rounded-md px-3 text-body text-text disabled:opacity-60 disabled:bg-surface-sunken"
              defaultValue=""
            >
              <option value="">{ar.signup.locationChoose}</option>
              {areas.map((area) => (
                <option key={area.slug} value={area.slug}>
                  {area.nameAr}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <MapPin className="size-4" aria-hidden />
            )}
            {locating ? ar.wizard.placeLocating : ar.signup.locationUseMine}
          </Button>

          {point && (
            <button
              type="button"
              onClick={() => setPoint(null)}
              className="text-fine text-muted hover:text-danger transition-colors"
            >
              {ar.common.cancel}
            </button>
          )}
        </div>

        {point && <p className="text-fine text-success">{ar.wizard.placeSelected}</p>}
        {locationDenied && <p className="text-fine text-muted">{ar.wizard.placeDenied}</p>}
      </div>

      {state && !state.ok && !state.field && (
        <p role="alert" className="text-meta text-danger">
          {state.error}
        </p>
      )}

      <div className="space-y-3">
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {ar.signup.photoUploading}
            </>
          ) : (
            ar.signup.finish
          )}
        </Button>

        {/* Skipping is a submit of an empty form, not a client-side jump: the
            account already exists, and this keeps one path through the action. */}
        <button
          type="button"
          onClick={onDone}
          className="block w-full text-center text-meta text-muted hover:text-text transition-colors"
        >
          {ar.signup.skip}
        </button>
      </div>
    </form>
  );
}
