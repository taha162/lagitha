import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/authz";
import { AuthorizationError } from "@/lib/authz";
import { readIdentityImage } from "@/lib/services/identity";

/**
 * The only way to see a national ID card.
 *
 * Everything about this handler is the opposite of `/api/media`: it requires a
 * staff session, it writes an `AdminAction` naming the viewer before it reads a
 * byte, and it tells every cache in the path — the browser's included — that
 * the response must not be kept. An unguessable key is not access control; this
 * is.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; side: string }> },
) {
  let staff;
  try {
    staff = await requireStaff();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // 404, not 403: a non-staff visitor learns nothing, not even that the
      // route exists.
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }

  const { id, side } = await context.params;
  if (side !== "front" && side !== "back") {
    return new NextResponse(null, { status: 404 });
  }

  const body = await readIdentityImage(staff, id, side);
  if (!body) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.byteLength),
      // Never stored anywhere: not by a CDN, not by the reviewer's browser.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Belt and braces against this URL leaking through a referrer header.
      "Referrer-Policy": "no-referrer",
    },
  });
}
