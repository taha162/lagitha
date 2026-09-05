import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { mediaUrl, newStorageKey, storage } from "@/lib/providers/storage";
import { PENDING_REPORT_ID } from "@/lib/services/reports";
import { couldBeAnImage } from "@/lib/uploads";
import { ar } from "@/i18n/ar";

/**
 * Image upload.
 *
 * A route handler rather than a server action, because the browser needs
 * upload progress and only XHR reports that.
 *
 * Every uploaded file is decoded and re-encoded to WebP by sharp. That is the
 * security boundary as much as the optimisation: whatever the client claims the
 * MIME type is, what lands in storage is a freshly encoded image, so a
 * polyglot file or a renamed script never survives the round trip. It also
 * means an 8 MB phone photo becomes roughly 150 KB, which matters a great deal
 * on the connections this product will actually be used on.
 */

const MAX_DIMENSION = 1600;
const THUMB_DIMENSION = 400;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: ar.errors.unauthorized }, { status: 401 });
  }

  const limit = await consumeRateLimit("imageUpload", user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: ar.errors.rateLimited(limit.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: ar.errors.uploadFailed }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: ar.errors.uploadFailed }, { status: 400 });
  }

  if (file.size > env.uploadMaxBytes) {
    return NextResponse.json({ error: ar.errors.uploadTooLarge }, { status: 413 });
  }
  if (!couldBeAnImage(file.type)) {
    return NextResponse.json({ error: ar.errors.uploadBadType }, { status: 415 });
  }

  const input = Buffer.from(await file.arrayBuffer());

  let full: Buffer;
  let thumb: Buffer;
  let width: number;
  let height: number;

  try {
    // `failOn: "truncated"` keeps a partially-uploaded file from being stored
    // as a valid-looking image.
    const pipeline = sharp(input, { failOn: "truncated" });
    const metadata = await pipeline.metadata();

    if (!metadata.width || !metadata.height) {
      return NextResponse.json({ error: ar.errors.imageBroken }, { status: 422 });
    }

    full = await sharp(input)
      .rotate() // honour EXIF orientation, then drop the metadata with it
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();

    thumb = await sharp(input)
      .rotate()
      .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: "cover", position: "attention" })
      .webp({ quality: 70 })
      .toBuffer();

    const resized = await sharp(full).metadata();
    width = resized.width ?? metadata.width;
    height = resized.height ?? metadata.height;
  } catch (error) {
    // Worth a line: a format the deployed sharp cannot decode (HEIC on a build
    // without libheif, say) looks identical to a corrupt file from here, and
    // only the log can tell the two apart.
    console.error("[LAGAITHA] could not decode an uploaded image:", error);
    return NextResponse.json({ error: ar.errors.imageBroken }, { status: 422 });
  }

  const fullKey = newStorageKey("reports", "webp");
  const thumbKey = newStorageKey("reports/thumbs", "webp");

  try {
    const store = await storage();
    await Promise.all([
      store.put(fullKey, full, "image/webp"),
      store.put(thumbKey, thumb, "image/webp"),
    ]);
  } catch (error) {
    // The image was fine; the place to put it was not. `storage()` throws with
    // the actual fix in the message — STORAGE_DRIVER=local on a read-only host,
    // a missing BLOB_READ_WRITE_TOKEN — and swallowing it turned a five-minute
    // configuration error into an unexplained failure for every member trying
    // to publish. Log the cause for whoever runs the site, and tell the person
    // the truth: it is not their photo, and they can publish without one.
    console.error("[LAGAITHA] image upload failed at the storage layer:", error);
    return NextResponse.json({ error: ar.errors.uploadStorage }, { status: 503 });
  }

  // Parked against a sentinel until the report is created and adopts it.
  const image = await prisma.reportImage.create({
    data: {
      reportId: PENDING_REPORT_ID,
      storageKey: fullKey,
      thumbKey,
      width,
      height,
      bytes: full.byteLength,
      mime: "image/webp",
    },
  });

  return NextResponse.json({
    id: image.id,
    url: mediaUrl(fullKey),
    thumbUrl: mediaUrl(thumbKey),
    width,
    height,
  });
}

/** Lets the wizard drop an image the user changed their mind about. */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: ar.errors.unauthorized }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad-request" }, { status: 400 });

  // Only unattached images can be deleted here; once a report owns an image,
  // removal goes through the report's own authorization path.
  const image = await prisma.reportImage.findFirst({
    where: { id, reportId: PENDING_REPORT_ID },
  });
  if (!image) return NextResponse.json({ ok: true });

  const store = await storage();
  await Promise.all([
    store.delete(image.storageKey).catch(() => undefined),
    store.delete(image.thumbKey).catch(() => undefined),
    prisma.reportImage.delete({ where: { id: image.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
