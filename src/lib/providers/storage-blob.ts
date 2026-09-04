import "server-only";
import { assertSafeKey, type StorageProvider } from "./storage";

/**
 * Vercel Blob driver.
 *
 * The reason this exists: `local` writes to the filesystem, and a serverless
 * host has none — `/var/task` is a read-only bundle, so every upload fails with
 * ENOENT deep inside a request. The portable answer is `s3`, which works with
 * any S3-compatible bucket; this is the answer for a deployment already on
 * Vercel, where a blob store needs no second account and no credentials to
 * copy: creating one sets `BLOB_READ_WRITE_TOKEN` for you.
 *
 * Only public media goes here — report photos and profile pictures, which are
 * public by nature. Identity documents are not stored as objects at all; see
 * `src/lib/services/identity.ts` for why.
 */
export class BlobStorageProvider implements StorageProvider {
  readonly name = "blob";

  constructor(private readonly token: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    const { put } = await import("@vercel/blob");

    await put(key, body, {
      access: "public",
      token: this.token,
      contentType,
      // Our keys are already unguessable and are stored on the row that points
      // at them, so a suffix chosen by the SDK would only make them unfindable.
      addRandomSuffix: false,
      // Re-uploading the same key is a retry, not a conflict.
      allowOverwrite: true,
    });
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const { get } = await import("@vercel/blob");

    const result = await get(key, { access: "public", token: this.token });
    if (!result) return null;

    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { del } = await import("@vercel/blob");

    // Deleting something already gone is success, not an error — callers use
    // this to clean up after a replaced avatar.
    await del(key, { token: this.token }).catch(() => undefined);
  }
}
