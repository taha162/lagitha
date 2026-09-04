import { NextResponse } from "next/server";
import { storage } from "@/lib/providers/storage";

/**
 * Serves uploaded media.
 *
 * Keys are opaque and unguessable, so this handler does not gate on session —
 * an image attached to a public report is public. What it does do is refuse to
 * serve anything that is not an image and pin the content type, so a file that
 * somehow got past upload validation still cannot execute in a browser.
 *
 * Everything it can reach is public by nature. Identity documents are not
 * stored as objects at all, so there is nothing here that this handler being
 * unauthenticated could expose.
 */
const ALLOWED_EXTENSIONS: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await context.params;
  const key = segments.join("/");

  const extension = key.split(".").pop()?.toLowerCase();
  const contentType = extension ? ALLOWED_EXTENSIONS[extension] : undefined;
  if (!contentType) {
    return new NextResponse(null, { status: 404 });
  }

  let body: Buffer | null;
  try {
    body = await (await storage()).get(key);
  } catch {
    // An invalid key throws rather than returning null; both mean "not found".
    return new NextResponse(null, { status: 404 });
  }

  if (!body) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
