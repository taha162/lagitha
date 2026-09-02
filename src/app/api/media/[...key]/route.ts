import { NextResponse } from "next/server";
import { isPrivateKey, storage } from "@/lib/providers/storage";

/**
 * Serves uploaded media.
 *
 * Keys are opaque and unguessable, so this handler does not gate on session —
 * an image attached to a public report is public. What it does do is refuse to
 * serve anything that is not an image and pin the content type, so a file that
 * somehow got past upload validation still cannot execute in a browser.
 *
 * Because it is unauthenticated by design, it also refuses the private prefix
 * outright. Identity documents live under that prefix and are readable only
 * through the staff route, which checks a role and records the read.
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

  // The one thing this handler must never do.
  if (isPrivateKey(key)) return new NextResponse(null, { status: 404 });

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
