import { cn } from "@/lib/utils";

/**
 * A member's photo, or their initial.
 *
 * The fallback is a letter rather than a generic silhouette: most accounts will
 * not have a photo, and a page full of identical grey heads reads as broken,
 * while a page of initials reads as people.
 *
 * Plain `<img>` rather than `next/image`: these are already square, already
 * WebP and at most 96 px, so the optimiser would have nothing left to do and
 * would only add a request to a route that has to be dynamic.
 */
const SIZES = {
  sm: "size-6 text-fine",
  md: "size-10 text-meta",
  lg: "size-20 text-h2",
} as const;

export function Avatar({
  url,
  name,
  size = "md",
  className,
}: {
  url: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initial = Array.from(name.trim())[0] ?? "؟";

  return (
    <span
      className={cn(
        "shrink-0 rounded-full overflow-hidden grid place-items-center select-none",
        "bg-primary-soft text-primary font-medium",
        SIZES[size],
        className,
      )}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initial
      )}
    </span>
  );
}
