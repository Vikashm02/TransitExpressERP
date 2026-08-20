"use client";

import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { organizationalRoleLabel } from "@/components/services/appUser.service";
import { useLanguage } from "@/lib/i18n";
import NotificationBell from "@/components/pwa/NotificationBell";
import LanguageSelector from "@/components/layout/LanguageSelector";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  /** Opens the mobile navigation drawer (see Sidebar.tsx). The trigger
   * button is only rendered below the `lg` breakpoint — desktop
   * header markup/behavior is otherwise unchanged. */
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const { profile, isAdmin, signOut } = useAuth();
  const { t } = useLanguage();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-card/90 px-3 backdrop-blur-md sm:h-16 sm:gap-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        {onMenuClick && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("common.openMenu")}
            aria-label={t("common.openMenu")}
            onClick={onMenuClick}
            className="-ml-1 shrink-0 text-muted-foreground hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t("header.operationsConsole")}
          </p>
          <h2 className="truncate font-heading text-base font-semibold text-foreground sm:text-lg">
            {t("header.appName")}
          </h2>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <NotificationBell />
        <LanguageSelector />

        <div className="hidden items-center gap-2.5 rounded-full border border-border/80 bg-surface-muted/70 py-1 pr-3 pl-1 sm:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground ring-2 ring-highlight/40">
            {(profile?.displayName || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-foreground">
              {profile?.displayName || "..."}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {profile
                ? organizationalRoleLabel(profile.role)
                : isAdmin
                  ? t("header.administrator")
                  : t("header.staff")}
            </p>
          </div>
        </div>

        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground sm:hidden">
          {(profile?.displayName || "?").charAt(0).toUpperCase()}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t("common.signOut")}
          aria-label={t("common.signOut")}
          onClick={handleSignOut}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
