import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/**
 * Public report pages are indexable; anything personal is not. Sensitive
 * reports are additionally excluded per-page via their own robots metadata.
 */
export default function robots(): MetadataRoute.Robots {
  if (env.siteNoindex) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/search", "/r/"],
        disallow: ["/me/", "/admin/", "/api/", "/login", "/report/new"],
      },
    ],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
