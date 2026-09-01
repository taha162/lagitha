"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ar } from "@/i18n/ar";
import { Button } from "@/components/ui/button";

/**
 * Application error boundary.
 *
 * The user gets a human sentence and a way forward; the stack goes to the
 * server log. Internal error text is never rendered — it helps nobody here and
 * can leak structure.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="text-center max-w-sm">
        <h1 className="text-h1 text-text-strong">{ar.errors.generic}</h1>
        <p className="mt-2 text-meta text-muted leading-relaxed">
          المشكلة من عندنا مو من عندك. جرّب مرة ثانية.
        </p>

        {error.digest && (
          <p className="mt-3 text-fine text-muted">
            رمز الخطأ: <span className="latin">{error.digest}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
          <Button size="lg" onClick={reset}>
            {ar.errors.retry}
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/">{ar.errors.goHome}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
