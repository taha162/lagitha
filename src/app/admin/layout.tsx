import type { Metadata } from "next";
import { ar } from "@/i18n/ar";

export const metadata: Metadata = {
  title: { default: ar.admin.title, template: `%s — ${ar.admin.title}` },
  robots: { index: false, follow: false },
};

/**
 * Everything under /admin, including the sign-in screen.
 *
 * The guard and the console chrome live one level down, in `(console)`, so
 * that `/admin/login` is reachable by a staff member who is not signed in.
 * A layout that required staff here would lock the door with the key inside.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
