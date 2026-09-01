"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { ar } from "@/i18n/ar";
import { cn } from "@/lib/utils";
import { COLORS, type WhenPreset } from "@/lib/attributes";
import type { Point } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { TextField, TextAreaField } from "@/components/ui/field";
import { CategoryIcon } from "@/components/category-icon";
import { LocationPicker, type AreaOption } from "@/components/map/location-picker";
import { ImageUploader, type UploadedImage } from "./image-uploader";
import { createReportAction } from "@/app/actions/reports";

/**
 * The report wizard.
 *
 * One question per screen, six screens, target under a minute. Progressive
 * disclosure rather than a single long form: someone standing in the street
 * having just lost their wallet will abandon a page that opens with twelve
 * fields, and every field they abandon is a report that never gets filed.
 *
 * Only two answers are actually required — what it is, and roughly where.
 * Everything else can be skipped and added later.
 */
interface CategoryOption {
  slug: string;
  nameAr: string;
  icon: string;
  sensitive: boolean;
  hintAr: string | null;
}

type StepId = "category" | "photo" | "place" | "when" | "details" | "review";

const STEPS: StepId[] = ["category", "photo", "place", "when", "details", "review"];

interface Draft {
  type: "LOST" | "FOUND";
  categorySlug: string | null;
  images: UploadedImage[];
  point: Point | null;
  areaSlug: string | null;
  areaName: string | null;
  landmark: string;
  when: WhenPreset;
  occurredAt: string;
  title: string;
  description: string;
  color: string;
  brand: string;
  verificationSecret: string;
}

export function ReportWizard({
  initialType,
  categories,
  areas,
}: {
  initialType: "LOST" | "FOUND";
  categories: CategoryOption[];
  areas: AreaOption[];
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ reference: string; matches: number } | null>(null);

  const [draft, setDraft] = useState<Draft>({
    type: initialType,
    categorySlug: null,
    images: [],
    point: null,
    areaSlug: null,
    areaName: null,
    landmark: "",
    when: "today",
    occurredAt: "",
    title: "",
    description: "",
    color: "",
    brand: "",
    verificationSecret: "",
  });

  const patch = useCallback((changes: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  const category = useMemo(
    () => categories.find((candidate) => candidate.slug === draft.categorySlug) ?? null,
    [categories, draft.categorySlug],
  );

  const step = STEPS[stepIndex]!;
  const isLost = draft.type === "LOST";

  const canAdvance = (() => {
    switch (step) {
      case "category":
        return Boolean(draft.categorySlug);
      case "place":
        return Boolean(draft.point || draft.areaSlug);
      case "when":
        return draft.when !== "exact" || Boolean(draft.occurredAt);
      case "details":
        return draft.title.trim().length >= 2;
      default:
        return true;
    }
  })();

  const goNext = () => setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));

  async function publish() {
    setSubmitting(true);
    setError(null);

    const result = await createReportAction({
      type: draft.type,
      categorySlug: draft.categorySlug,
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      color: draft.color || undefined,
      brand: draft.brand.trim() || undefined,
      when: draft.when,
      occurredAt:
        draft.when === "exact" && draft.occurredAt
          ? new Date(draft.occurredAt).toISOString()
          : undefined,
      point: draft.point ?? undefined,
      areaSlug: draft.areaSlug ?? undefined,
      landmark: draft.landmark.trim() || undefined,
      verificationSecret: draft.verificationSecret.trim() || undefined,
      imageIds: draft.images.map((image) => image.id),
    });

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPublished(result.data);
  }

  if (published) {
    return <PublishedScreen result={published} type={draft.type} />;
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="sticky top-0 z-20 bg-background border-b border-border">
        <div className="mx-auto max-w-xl px-4 h-14 flex items-center gap-3">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={goBack}
              className="-ms-2 size-9 grid place-items-center rounded-sm text-muted hover:text-text hover:bg-surface-sunken transition-colors"
              aria-label={ar.wizard.back}
            >
              <ArrowRight className="size-5" aria-hidden />
            </button>
          ) : (
            <Link
              href="/"
              className="-ms-2 size-9 grid place-items-center rounded-sm text-muted hover:text-text hover:bg-surface-sunken transition-colors"
              aria-label={ar.errors.goBack}
            >
              <ArrowRight className="size-5" aria-hidden />
            </Link>
          )}

          <div className="flex-1 min-w-0">
            <h1 className="text-h3 text-text-strong truncate">
              {isLost ? ar.wizard.titleLost : ar.wizard.titleFound}
            </h1>
          </div>

          <span className="text-fine text-muted shrink-0 tabular-nums">
            {ar.wizard.stepOf(stepIndex + 1, STEPS.length)}
          </span>
        </div>

        {/* Progress is a thin rule, not a component that needs explaining. */}
        <div
          className="h-0.5 bg-border"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={stepIndex + 1}
          aria-label={ar.wizard.stepOf(stepIndex + 1, STEPS.length)}
        >
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </header>

      <main id="main" className="flex-1 mx-auto w-full max-w-xl px-4 py-6 pb-32">
        {step === "category" && (
          <CategoryStep
            categories={categories}
            selected={draft.categorySlug}
            onSelect={(slug) => {
              patch({ categorySlug: slug });
              // Choosing a category is unambiguous — advance without an extra tap.
              setTimeout(goNext, 140);
            }}
          />
        )}

        {step === "photo" && (
          <PhotoStep
            isLost={isLost}
            sensitive={category?.sensitive ?? false}
            images={draft.images}
            onChange={(images) => patch({ images })}
          />
        )}

        {step === "place" && (
          <PlaceStep
            isLost={isLost}
            areas={areas}
            draft={draft}
            onChange={(changes) => patch(changes)}
          />
        )}

        {step === "when" && (
          <WhenStep isLost={isLost} draft={draft} onChange={(changes) => patch(changes)} />
        )}

        {step === "details" && (
          <DetailsStep
            isLost={isLost}
            draft={draft}
            onChange={(changes) => patch(changes)}
          />
        )}

        {step === "review" && (
          <ReviewStep
            draft={draft}
            category={category}
            onEdit={(target) => setStepIndex(STEPS.indexOf(target))}
          />
        )}

        {error && (
          <p
            role="alert"
            className="mt-5 flex items-start gap-2 text-meta text-danger bg-danger-soft border border-danger/25 rounded-md px-3 py-2.5"
          >
            <CircleAlert className="size-4 shrink-0 mt-0.5" aria-hidden />
            {error}
          </p>
        )}
      </main>

      {/* Sticky action bar: the primary action is always in reach of a thumb. */}
      <footer className="fixed inset-x-0 bottom-0 z-20 bg-surface border-t border-border pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-xl px-4 py-3 flex items-center gap-3">
          {step === "photo" && draft.images.length === 0 && (
            <Button variant="ghost" size="lg" onClick={goNext} className="shrink-0">
              {ar.wizard.photoSkip}
            </Button>
          )}

          {step === "review" ? (
            <Button size="lg" block onClick={publish} disabled={submitting}>
              {submitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {ar.wizard.publishing}
                </>
              ) : (
                ar.wizard.publish
              )}
            </Button>
          ) : (
            <Button size="lg" block onClick={goNext} disabled={!canAdvance}>
              {ar.wizard.next}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ steps ---

function StepHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-h1 text-text-strong">{title}</h2>
      {hint && <p className="mt-1.5 text-meta text-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

function CategoryStep({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryOption[];
  selected: string | null;
  onSelect: (slug: string) => void;
}) {
  return (
    <div>
      <StepHeading title={ar.wizard.categoryTitle} hint={ar.wizard.categoryHint} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {categories.map((category) => {
          const active = selected === category.slug;
          return (
            <button
              key={category.slug}
              type="button"
              onClick={() => onSelect(category.slug)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center justify-center gap-2 p-4 min-h-24",
                "rounded-md border text-center transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-text hover:border-border-strong",
              )}
            >
              <CategoryIcon name={category.icon} className="size-6" />
              <span className="text-meta font-medium leading-tight">{category.nameAr}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PhotoStep({
  isLost,
  sensitive,
  images,
  onChange,
}: {
  isLost: boolean;
  sensitive: boolean;
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}) {
  return (
    <div>
      <StepHeading
        title={ar.wizard.photoTitle}
        hint={isLost ? ar.wizard.photoHintLost : ar.wizard.photoHintFound}
      />

      {sensitive && (
        <p className="mb-4 flex items-start gap-2 text-fine text-warning bg-warning-soft border border-warning/25 rounded-md px-3 py-2.5">
          <CircleAlert className="size-4 shrink-0 mt-0.5" aria-hidden />
          {ar.wizard.photoSensitiveWarning}
        </p>
      )}

      <ImageUploader images={images} onChange={onChange} max={4} />
    </div>
  );
}

function PlaceStep({
  isLost,
  areas,
  draft,
  onChange,
}: {
  isLost: boolean;
  areas: AreaOption[];
  draft: Draft;
  onChange: (changes: Partial<Draft>) => void;
}) {
  return (
    <div>
      <StepHeading title={isLost ? ar.wizard.placeTitleLost : ar.wizard.placeTitleFound} />

      <LocationPicker
        areas={areas}
        type={draft.type}
        value={{ point: draft.point, areaSlug: draft.areaSlug }}
        onChange={(next) =>
          onChange({ point: next.point, areaSlug: next.areaSlug, areaName: next.areaName })
        }
      />

      {draft.areaName && (
        <p className="mt-3 text-meta">
          <span className="text-muted">{ar.wizard.placeSelected}: </span>
          <span className="text-text font-medium">{draft.areaName}</span>
        </p>
      )}

      <div className="mt-4">
        <TextField
          label={ar.wizard.placeLandmark}
          placeholder={ar.wizard.placeLandmarkExample}
          value={draft.landmark}
          onChange={(event) => onChange({ landmark: event.target.value })}
          maxLength={60}
        />
      </div>
    </div>
  );
}

const WHEN_PRESETS: { value: WhenPreset; label: string }[] = [
  { value: "today", label: ar.wizard.whenToday },
  { value: "yesterday", label: ar.wizard.whenYesterday },
  { value: "this-week", label: ar.wizard.whenThisWeek },
  { value: "exact", label: ar.wizard.whenExact },
];

function WhenStep({
  isLost,
  draft,
  onChange,
}: {
  isLost: boolean;
  draft: Draft;
  onChange: (changes: Partial<Draft>) => void;
}) {
  // Local midnight-to-now, formatted for datetime-local's expected value.
  const maxDateTime = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  return (
    <div>
      <StepHeading title={isLost ? ar.wizard.whenTitleLost : ar.wizard.whenTitleFound} />

      <div className="grid grid-cols-2 gap-2.5">
        {WHEN_PRESETS.map((preset) => {
          const active = draft.when === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChange({ when: preset.value })}
              aria-pressed={active}
              className={cn(
                "h-14 px-4 rounded-md border text-body font-medium transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-text hover:border-border-strong",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {draft.when === "exact" && (
        <div className="mt-4 enter-fade">
          <TextField
            type="datetime-local"
            label={ar.wizard.whenExact}
            value={draft.occurredAt}
            max={maxDateTime}
            onChange={(event) => onChange({ occurredAt: event.target.value })}
            className="latin"
          />
        </div>
      )}
    </div>
  );
}

function DetailsStep({
  isLost,
  draft,
  onChange,
}: {
  isLost: boolean;
  draft: Draft;
  onChange: (changes: Partial<Draft>) => void;
}) {
  return (
    <div className="space-y-5">
      <StepHeading title={ar.wizard.detailsTitle} hint={ar.wizard.detailsHint} />

      <TextField
        label={ar.wizard.titleLabel}
        placeholder={isLost ? ar.wizard.titleExampleLost : ar.wizard.titleExampleFound}
        value={draft.title}
        onChange={(event) => onChange({ title: event.target.value })}
        maxLength={80}
        required
        autoFocus
      />

      <TextAreaField
        label={ar.wizard.descriptionLabel}
        placeholder={ar.wizard.descriptionExample}
        value={draft.description}
        onChange={(event) => onChange({ description: event.target.value })}
        maxLength={600}
        optional
        rows={3}
      />

      <fieldset>
        <legend className="text-meta font-medium text-text mb-2">
          {ar.wizard.colorLabel}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((color) => {
            const active = draft.color === color.value;
            return (
              <button
                key={color.value}
                type="button"
                onClick={() => onChange({ color: active ? "" : color.value })}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 h-9 ps-2 pe-3 rounded-pill border text-fine transition-colors",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted hover:border-border-strong",
                )}
              >
                <span
                  className="size-4 rounded-full border border-border-strong shrink-0"
                  style={{ backgroundColor: color.swatch }}
                  aria-hidden
                />
                {color.nameAr}
              </button>
            );
          })}
        </div>
      </fieldset>

      <TextField
        label={ar.wizard.brandLabel}
        value={draft.brand}
        onChange={(event) => onChange({ brand: event.target.value })}
        maxLength={40}
        optional
      />

      {/* The finder's private detail. Asked here so verification can be fair
          later without a second visit. */}
      {!isLost && (
        <div className="pt-2 border-t border-border">
          <TextAreaField
            label={ar.wizard.secretTitle}
            hint={ar.wizard.secretHint}
            placeholder={ar.wizard.secretExample}
            value={draft.verificationSecret}
            onChange={(event) => onChange({ verificationSecret: event.target.value })}
            maxLength={200}
            optional
            rows={2}
          />
        </div>
      )}
    </div>
  );
}

function ReviewStep({
  draft,
  category,
  onEdit,
}: {
  draft: Draft;
  category: CategoryOption | null;
  onEdit: (step: StepId) => void;
}) {
  const whenLabel = WHEN_PRESETS.find((preset) => preset.value === draft.when)?.label ?? "";
  const colorLabel = COLORS.find((color) => color.value === draft.color)?.nameAr;

  return (
    <div>
      <StepHeading title={ar.wizard.reviewTitle} hint={ar.wizard.reviewHint} />

      <dl className="divide-y divide-border border border-border rounded-md bg-surface">
        <ReviewRow label={ar.report.category} value={category?.nameAr} onEdit={() => onEdit("category")} />
        <ReviewRow
          label={ar.report.images}
          value={draft.images.length > 0 ? `${draft.images.length}` : ar.report.noImages}
          onEdit={() => onEdit("photo")}
        />
        <ReviewRow
          label={ar.report.area}
          value={
            draft.areaName
              ? draft.landmark
                ? `${draft.areaName} — ${draft.landmark}`
                : draft.areaName
              : undefined
          }
          onEdit={() => onEdit("place")}
        />
        <ReviewRow label="متى" value={whenLabel} onEdit={() => onEdit("when")} />
        <ReviewRow label={ar.wizard.titleLabel} value={draft.title} onEdit={() => onEdit("details")} />
        {draft.description && (
          <ReviewRow label={ar.report.description} value={draft.description} onEdit={() => onEdit("details")} />
        )}
        {colorLabel && <ReviewRow label={ar.report.color} value={colorLabel} onEdit={() => onEdit("details")} />}
        {draft.brand && <ReviewRow label={ar.report.brand} value={draft.brand} onEdit={() => onEdit("details")} />}
      </dl>

      <p className="mt-4 flex items-start gap-2 text-fine text-muted">
        <ShieldCheck className="size-4 shrink-0 mt-0.5 text-success" aria-hidden strokeWidth={1.75} />
        {category?.sensitive ? ar.wizard.privacySensitive : ar.wizard.privacyLost}
      </p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value?: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <dt className="w-24 shrink-0 text-fine text-muted pt-0.5">{label}</dt>
      <dd className="flex-1 min-w-0 text-meta text-text break-words">
        {value || <span className="text-muted">—</span>}
      </dd>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-fine text-primary hover:text-primary-hover transition-colors"
      >
        {ar.wizard.reviewEdit}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ confirmation --

function PublishedScreen({
  result,
  type,
}: {
  result: { reference: string; matches: number };
  type: "LOST" | "FOUND";
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/r/${result.reference}`;
    const shareData = {
      title: ar.meta.brand,
      text: ar.meta.tagline,
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // The user dismissed the share sheet — fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div
          className="mx-auto size-14 rounded-full bg-success-soft text-success grid place-items-center"
          aria-hidden
        >
          <Check className="size-7" strokeWidth={2} />
        </div>

        <h1 className="mt-5 text-h1 text-text-strong">{ar.success.published}</h1>
        <p className="mt-1.5 text-meta text-muted leading-relaxed">
          {result.matches > 0
            ? `${ar.match.found} ${
                result.matches === 1 ? ar.match.title : `${result.matches} ${ar.match.plural}`
              }.`
            : ar.success.publishedNote}
        </p>

        <p className="mt-4 text-fine text-muted">
          {ar.report.reference}:{" "}
          <span className="latin font-medium text-text">{result.reference}</span>
        </p>

        <div className="mt-7 space-y-2.5">
          <Button size="lg" block onClick={share}>
            {copied ? ar.success.copied : ar.success.share}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => router.push(`/r/${result.reference}`)}
          >
            {ar.success.viewReport}
          </Button>
          <Button
            variant="ghost"
            size="md"
            block
            onClick={() => router.push(`/report/new?type=${type}`)}
          >
            {ar.success.addAnother}
          </Button>
        </div>
      </div>
    </div>
  );
}
