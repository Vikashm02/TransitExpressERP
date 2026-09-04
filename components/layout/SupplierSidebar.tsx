"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Lightbulb, LogOut, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useLanguage } from "@/lib/i18n";
import { organizationalRoleLabel } from "@/components/services/appUser.service";
import { SUPPLIER_HOME } from "@/lib/app-area";

interface SupplierSidebarProps {
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

/**
 * Supplier-area navigation shell. Transport Sidebar is untouched.
 * Visual identity comes from scoped .supplier-shell tokens + local chrome.
 */
export default function SupplierSidebar({
  mobileOpen = false,
  onMobileOpenChange,
}: SupplierSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isAdmin, signOut } = useAuth();
  const { t } = useLanguage();

  const intelligenceActive =
    pathname === "/supplier" ||
    pathname === SUPPLIER_HOME ||
    (pathname?.startsWith(`${SUPPLIER_HOME}/`) ?? false);

  async function handleSignOut() {
    onMobileOpenChange?.(false);
    await signOut();
    router.replace("/login");
  }

  function closeMobileNav() {
    onMobileOpenChange?.(false);
  }

  function renderNav(onNavigate?: () => void) {
    return (
      <div className="space-y-1">
        <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/40">
          Workspace
        </p>
        <Link
          href={SUPPLIER_HOME}
          title="Intelligence"
          onClick={onNavigate}
          className={cn(
            "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
            intelligenceActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          {intelligenceActive && (
            <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r bg-sidebar-primary-foreground/90" />
          )}
          <Lightbulb
            className={cn(
              "h-4 w-4 shrink-0",
              intelligenceActive ? "opacity-100" : "opacity-75 group-hover:opacity-100",
            )}
          />
          <span className="truncate">Intelligence</span>
        </Link>
      </div>
    );
  }

  function brandBlock(compact = false) {
    return (
      <div className={cn("flex items-center gap-3", compact ? "px-4 py-4" : "px-5 py-5")}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary/20 ring-1 ring-sidebar-primary/35">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Transjit"
            className="h-9 w-9 object-contain"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-heading text-base font-semibold leading-tight tracking-tight">
            Transjit
          </h1>
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-primary/90">
            Supplier
          </p>
        </div>
      </div>
    );
  }

  function userFooter(onSignOut: () => void, compact = false) {
    return (
      <div className={cn("border-t border-sidebar-border", compact ? "p-4" : "p-5")}>
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
            {(profile?.displayName || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{profile?.displayName || "..."}</p>
            <p className="text-xs text-sidebar-foreground/60">
              {profile
                ? organizationalRoleLabel(profile.role)
                : isAdmin
                  ? t("header.administrator")
                  : t("header.staff")}
            </p>
          </div>
          <button
            type="button"
            title={t("common.signOut")}
            onClick={onSignOut}
            className="shrink-0 rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <aside className="relative hidden min-h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-sidebar-primary/70"
        />
        <div className="shrink-0 border-b border-sidebar-border">{brandBlock()}</div>
        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
          {renderNav()}
        </nav>
        {userFooter(handleSignOut)}
      </aside>

      <DialogPrimitive.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] lg:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />

          <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl outline-none lg:hidden data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
            <DialogPrimitive.Title className="sr-only">
              Supplier navigation
            </DialogPrimitive.Title>

            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-sidebar-primary/70"
            />

            <div className="flex items-center justify-between gap-3 border-b border-sidebar-border">
              {brandBlock(true)}
              <DialogPrimitive.Close
                className="mr-3 shrink-0 rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label={t("common.closeMenu")}
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto px-2.5 py-2">
              {renderNav(closeMobileNav)}
            </nav>

            {userFooter(handleSignOut, true)}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
