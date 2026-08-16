"use client";

import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { useAuth } from "@/lib/auth/AuthProvider";
import NotificationBell from "@/components/pwa/NotificationBell";

interface HeaderProps {
  /** Opens the mobile navigation drawer (see Sidebar.tsx). The trigger
   * button is only rendered below the `lg` breakpoint — desktop
   * header markup/behavior is otherwise unchanged. */
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const { profile, isAdmin, signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-card px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            title="Open menu"
            aria-label="Open menu"
            onClick={onMenuClick}
            className="-ml-1.5 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <h2 className="truncate text-base font-semibold text-foreground sm:text-lg">
          Transjit Express TMS
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <NotificationBell />

        <span className="hidden text-sm font-medium text-foreground sm:inline">
          {profile?.displayName || "..."} {isAdmin && "(Admin)"}
        </span>

        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {(profile?.displayName || "?").charAt(0).toUpperCase()}
        </div>

        <button
          type="button"
          title="Sign out"
          onClick={handleSignOut}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
