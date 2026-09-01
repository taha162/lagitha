import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { reportsNear, recoveryCountForUser } from "@/lib/services/reports";
import { toPublicReport } from "@/lib/privacy";
import { formatDistance, isWithinServiceArea } from "@/lib/geo";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * Reports near a point.
 *
 * The caller's coordinates are used for this one query and never stored. The
 * response goes through `toPublicReport`, so it carries coarsened positions
 * only — the same data any visitor could read from the page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    lat: url.searchParams.get("lat"),
    lng: url.searchParams.get("lng"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const point = { lat: parsed.data.lat, lng: parsed.data.lng };

  // Outside Mosul there is nothing to show; say so rather than scanning.
  if (!isWithinServiceArea(point)) {
    return NextResponse.json({ items: [] });
  }

  const viewer = await getCurrentUser();
  const nearby = await reportsNear(point, 6, 8);

  const items = await Promise.all(
    nearby.map(async ({ report, distanceM }) => ({
      report: toPublicReport(report, {
        viewerId: viewer?.id,
        authorRecoveries: await recoveryCountForUser(report.userId),
      }),
      distanceLabel: formatDistance(distanceM),
    })),
  );

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
