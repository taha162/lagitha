import Link from "next/link";
import type { ReactNode } from "react";
import { ar } from "@/i18n/ar";
import { BrandLockup } from "./brand";

/**
 * The frame around every screen in the sign-in / sign-up group.
 *
 * These four pages are the only ones a signed-out visitor sees in full, and
 * they deliberately drop the app chrome: no bottom navigation, no search bar,
 * nothing to wander off into. One column, one task.
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col bg-canvas">
      <header className="px-4 h-14 flex items-center border-b border-border">
        <BrandLockup />
      </header>

      <main id="main" className="flex-1 px-4 py-8">
        <div className="mx-auto w-full max-w-sm">
          {children}

          {footer}

          <p className="mt-8 text-center">
            <Link href="/" className="text-meta text-primary hover:text-primary-hover">
              {ar.errors.goHome}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
