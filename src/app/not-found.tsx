import Link from "next/link";
import { ar } from "@/i18n/ar";
import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="px-4 h-14 flex items-center border-b border-border">
        <BrandLockup />
      </header>

      <main id="main" className="flex-1 grid place-items-center px-4 py-12">
        <div className="text-center max-w-sm">
          <h1 className="text-h1 text-text-strong">{ar.errors.notFound}</h1>
          <p className="mt-2 text-meta text-muted leading-relaxed">{ar.errors.notFoundHint}</p>

          <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
            <Button asChild size="lg">
              <Link href="/">{ar.errors.goHome}</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/search">{ar.home.search}</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
