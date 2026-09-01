import type { User } from "@/generated/prisma/client";
import { SiteHeader } from "./site-header";
import { BottomNav } from "./bottom-nav";
import { cn } from "@/lib/utils";

/**
 * Page frame for the user-facing app. The admin console has its own shell —
 * it is an operations tool, not a second copy of this.
 */
export function AppShell({
  user,
  unreadNotifications = 0,
  unreadMessages = 0,
  children,
  width = "default",
}: {
  user: User | null;
  unreadNotifications?: number;
  unreadMessages?: number;
  children: React.ReactNode;
  width?: "default" | "narrow" | "wide";
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <SiteHeader
        user={user}
        unreadNotifications={unreadNotifications}
        unreadMessages={unreadMessages}
      />

      <main
        id="main"
        className={cn(
          "flex-1 w-full mx-auto px-4 py-5",
          // Leaves room for the mobile bottom bar.
          "pb-24 sm:pb-10",
          width === "narrow" && "max-w-2xl",
          width === "default" && "max-w-5xl",
          width === "wide" && "max-w-6xl",
        )}
      >
        {children}
      </main>

      <BottomNav unreadCount={unreadNotifications} />
    </div>
  );
}
