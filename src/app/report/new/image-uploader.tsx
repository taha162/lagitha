"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, ImagePlus, X, LoaderCircle } from "lucide-react";
import { ar } from "@/i18n/ar";
import { cn } from "@/lib/utils";

/**
 * Image upload with real progress.
 *
 * XHR rather than `fetch`, because the upload-progress event is the whole point:
 * on a slow connection a photo can take fifteen seconds, and a spinner with no
 * movement is indistinguishable from a hung app. The server does the resizing —
 * this component's job is to keep the user informed and let them undo.
 */
export interface UploadedImage {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

interface Pending {
  key: string;
  previewUrl: string;
  progress: number;
  error?: string;
}

export function ImageUploader({
  images,
  onChange,
  max = 4,
}: {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  max?: number;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const slotsLeft = max - images.length - pending.length;

  const upload = useCallback(
    (file: File) => {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      const previewUrl = URL.createObjectURL(file);
      setPending((current) => [...current, { key, previewUrl, progress: 0 }]);

      const body = new FormData();
      body.append("file", file);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/uploads");

      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const progress = Math.round((event.loaded / event.total) * 100);
        setPending((current) =>
          current.map((item) => (item.key === key ? { ...item, progress } : item)),
        );
      });

      request.addEventListener("load", () => {
        URL.revokeObjectURL(previewUrl);

        if (request.status >= 200 && request.status < 300) {
          const uploaded = JSON.parse(request.responseText) as UploadedImage;
          setPending((current) => current.filter((item) => item.key !== key));
          onChange([...images, uploaded]);
          return;
        }

        // Show the server's Arabic message when it sent one — it is more
        // specific than "upload failed" (too large, wrong type, unreadable).
        let message: string = ar.wizard.photoFailed;
        try {
          const payload = JSON.parse(request.responseText) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // Keep the generic message.
        }
        setPending((current) =>
          current.map((item) => (item.key === key ? { ...item, error: message } : item)),
        );
      });

      request.addEventListener("error", () => {
        URL.revokeObjectURL(previewUrl);
        setPending((current) =>
          current.map((item) =>
            item.key === key ? { ...item, error: ar.errors.offline } : item,
          ),
        );
      });

      request.send(body);
    },
    [images, onChange],
  );

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList).slice(0, Math.max(0, slotsLeft))) {
      upload(file);
    }
  };

  const remove = async (image: UploadedImage) => {
    onChange(images.filter((candidate) => candidate.id !== image.id));
    // Best-effort cleanup of the orphaned upload; the report is unaffected
    // either way.
    await fetch(`/api/uploads?id=${encodeURIComponent(image.id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  };

  return (
    <div className="space-y-3">
      {(images.length > 0 || pending.length > 0) && (
        <ul className="grid grid-cols-3 gap-2.5">
          {images.map((image) => (
            <li key={image.id} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.thumbUrl}
                alt=""
                className="size-full object-cover rounded-md border border-border"
              />
              <button
                type="button"
                onClick={() => remove(image)}
                aria-label={ar.wizard.photoRemove}
                className="absolute top-1.5 end-1.5 size-7 grid place-items-center rounded-full bg-ink/70 text-white hover:bg-ink transition-colors"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}

          {pending.map((item) => (
            <li key={item.key} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt=""
                className="size-full object-cover rounded-md border border-border opacity-55"
              />

              {item.error ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2 rounded-md bg-danger-soft/95 border border-danger/30 text-center">
                  <p className="text-[11px] leading-tight text-danger">{item.error}</p>
                  <button
                    type="button"
                    onClick={() =>
                      setPending((current) => current.filter((p) => p.key !== item.key))
                    }
                    className="text-[11px] font-medium text-danger underline"
                  >
                    {ar.common.close}
                  </button>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-ink/35">
                  <LoaderCircle className="size-5 animate-spin text-white" aria-hidden />
                  <div
                    className="w-3/5 h-1 rounded-full bg-white/35 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={ar.wizard.photoUploading}
                  >
                    <div
                      className="h-full bg-white transition-[width] duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {slotsLeft > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {/* `capture` opens the camera directly on mobile — one tap instead of
              a file browser detour. */}
          <UploadButton
            icon={<Camera className="size-5" strokeWidth={1.75} />}
            label={ar.wizard.photoCamera}
            onClick={() => cameraRef.current?.click()}
          />
          <UploadButton
            icon={<ImagePlus className="size-5" strokeWidth={1.75} />}
            label={ar.wizard.photoGallery}
            onClick={() => galleryRef.current?.click()}
          />
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <p className="text-fine text-muted">{ar.wizard.photoLimit(max)}</p>
    </div>
  );
}

function UploadButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 h-24",
        "rounded-md border border-dashed border-border-strong bg-surface",
        "text-muted hover:border-primary hover:text-primary transition-colors",
      )}
    >
      {icon}
      <span className="text-meta font-medium">{label}</span>
    </button>
  );
}
