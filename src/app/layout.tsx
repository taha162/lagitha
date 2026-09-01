import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { ar } from "@/i18n/ar";
import { env } from "@/lib/env";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

/**
 * Two families, chosen for legibility rather than fashion:
 * IBM Plex Sans Arabic carries the interface, Inter handles Latin runs
 * (brand names, phone numbers, report references) where Arabic faces render
 * digits inconsistently.
 */
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-arabic",
  display: "swap",
});

const latin = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-latin",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: `${ar.meta.brand} — ${ar.meta.tagline}`,
    template: `%s — ${ar.meta.brand}`,
  },
  description: ar.meta.description,
  applicationName: ar.meta.brand,
  openGraph: {
    type: "website",
    locale: "ar_IQ",
    siteName: ar.meta.brand,
    title: `${ar.meta.brand} — ${ar.meta.tagline}`,
    description: ar.meta.description,
  },
  // Staging deployments set SITE_NOINDEX=1 to stay out of search results.
  robots: env.siteNoindex ? { index: false, follow: false } : undefined,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#131a18" },
  ],
  width: "device-width",
  initialScale: 1,
  // Never block zoom: it is the accessibility feature most often broken by
  // "app-like" mobile layouts.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${arabic.variable} ${latin.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:bg-surface focus:text-text focus:px-4 focus:py-2 focus:rounded-md focus:border focus:border-primary"
        >
          {ar.nav.skipToContent}
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
