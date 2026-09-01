import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // sharp is used inside route handlers; keep it external so Next does not try
  // to bundle the native binary.
  serverExternalPackages: ["sharp"],
  experimental: {
    // The report wizard posts images as multipart; keep the ceiling aligned
    // with UPLOAD_MAX_BYTES so the server rejects with our Arabic error copy
    // rather than a framework-level 413.
    serverActions: { bodySizeLimit: "8mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(self), microphone=()",
          },
        ],
      },
      {
        // Uploaded media is immutable: the key changes when the file changes.
        source: "/api/media/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
