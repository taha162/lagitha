"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PublicImage } from "@/lib/privacy";

/**
 * Report images. One large view plus thumbnails — no lightbox, no carousel
 * library: a person checking whether this is their wallet wants the picture
 * bigger, not an experience.
 */
export function ReportGallery({
  images,
  title,
}: {
  images: PublicImage[];
  title: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex] ?? images[0];
  if (!active) return null;

  return (
    <div className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={active.url}
        alt={title}
        width={active.width}
        height={active.height}
        className="w-full max-h-[26rem] object-contain rounded-md border border-border bg-surface-sunken"
        // The first image is the page's focal content; the rest can wait.
        loading="eager"
        decoding="async"
      />

      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => (
            <li key={image.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`${index + 1}`}
                aria-current={index === activeIndex ? "true" : undefined}
                className={cn(
                  "block size-16 rounded-sm overflow-hidden border-2 transition-colors",
                  index === activeIndex ? "border-primary" : "border-border hover:border-border-strong",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbUrl}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
