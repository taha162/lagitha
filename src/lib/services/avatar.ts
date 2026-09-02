import "server-only";
import sharp from "sharp";
import type { User } from "@/generated/prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { consumeRateLimit } from "../rate-limit";
import { newStorageKey, storage } from "../providers/storage";

/**
 * Profile photos.
 *
 * Two sizes, both square: the 96 px one is what a report card renders, and the
 * 320 px one is for the account page. Anything larger would be paid for on
 * every scroll of the search results by people on a mobile connection.
 *
 * Like report images, the file is decoded and re-encoded rather than stored:
 * that drops EXIF — a selfie carries the GPS coordinates of wherever it was
 * taken — and guarantees that whatever lands in the bucket is an image.
 */

const AVATAR_SIZE = 320;
const AVATAR_THUMB_SIZE = 96;

export class AvatarError extends Error {
  constructor(readonly kind: "too-large" | "unreadable" | "rate-limited") {
    super(kind);
    this.name = "AvatarError";
  }
}

export async function setAvatar(user: User, file: File): Promise<User> {
  const limit = await consumeRateLimit("imageUpload", user.id);
  if (!limit.allowed) throw new AvatarError("rate-limited");
  if (file.size > env.uploadMaxBytes) throw new AvatarError("too-large");

  const input = Buffer.from(await file.arrayBuffer());

  let full: Buffer;
  let thumb: Buffer;
  try {
    const metadata = await sharp(input, { failOn: "truncated" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("no dimensions");

    // `position: "attention"` keeps a face in frame when a portrait photo is
    // cropped to a square.
    full = await sharp(input)
      .rotate()
      .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();

    thumb = await sharp(input)
      .rotate()
      .resize({
        width: AVATAR_THUMB_SIZE,
        height: AVATAR_THUMB_SIZE,
        fit: "cover",
        position: "attention",
      })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
    throw new AvatarError("unreadable");
  }

  const key = newStorageKey("avatars", "webp");
  const thumbKey = newStorageKey("avatars/thumbs", "webp");

  const store = await storage();
  await Promise.all([
    store.put(key, full, "image/webp"),
    store.put(thumbKey, thumb, "image/webp"),
  ]);

  const previous = { key: user.avatarKey, thumbKey: user.avatarThumbKey };
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { avatarKey: key, avatarThumbKey: thumbKey },
  });

  await removeObjects(previous);
  return updated;
}

export async function clearAvatar(user: User): Promise<User> {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { avatarKey: null, avatarThumbKey: null },
  });

  await removeObjects({ key: user.avatarKey, thumbKey: user.avatarThumbKey });
  return updated;
}

async function removeObjects(keys: { key: string | null; thumbKey: string | null }) {
  const present = [keys.key, keys.thumbKey].filter((value): value is string => Boolean(value));
  if (present.length === 0) return;

  const store = await storage();
  await Promise.all(present.map((key) => store.delete(key).catch(() => undefined)));
}
