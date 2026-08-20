"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  LayoutDashboard,
  Building2,
  Users,
  Banknote,
  Truck,
  Package,
  FileText,
  ClipboardCheck,
  ScrollText,
  ClipboardList,
  ReceiptIndianRupee,
  FileMinus2,
  FilePlus2,
  BookOpen,
  BarChart3,
  Settings,
  Wallet,
  UserCog,
  UserRound,
  LogOut,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useLanguage } from "@/lib/i18n";
import type { PermissionKey } from "@/lib/permissions";
import { organizationalRoleLabel } from "@/components/services/appUser.service";

type MenuItem = {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  permissionKey?: PermissionKey;
  adminOnly?: boolean;
};

type MenuSection = {
  titleKey: string;
  items: MenuItem[];
};

const menuSections: MenuSection[] = [
  {
    titleKey: "nav.section.overview",
    items: [
      { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
      { labelKey: "nav.profile", href: "/profile", icon: UserRound },
    ],
  },
  {
    titleKey: "nav.section.masters",
    items: [
      { labelKey: "nav.company", href: "/company", icon: Building2, permissionKey: "company" },
      { labelKey: "nav.customers", href: "/customers", icon: Users, permissionKey: "customers" },
      {
        labelKey: "nav.billingParties",
        href: "/billing-parties",
        icon: Banknote,
        permissionKey: "billing_parties",
      },
      { labelKey: "nav.vehicle", href: "/vehicle", icon: Truck, permissionKey: "vehicle" },
      { labelKey: "nav.material", href: "/material", icon: Package, permissionKey: "material" },
    ],
  },
  {
    titleKey: "nav.section.operations",
    items: [
      { labelKey: "nav.lr", href: "/lr", icon: FileText, permissionKey: "lr" },
      { labelKey: "nav.pod", href: "/pod", icon: ClipboardCheck, permissionKey: "pod" },
      {
        labelKey: "nav.deliveryChallans",
        href: "/delivery-challans",
        icon: ScrollText,
        permissionKey: "delivery_challans",
      },
      { labelKey: "nav.asn", href: "/asn", icon: ClipboardList, permissionKey: "asn_creations" },
    ],
  },
  {
    titleKey: "nav.section.finance",
    items: [
      {
        labelKey: "nav.lorryExpenses",
        href: "/lorry-expenses",
        icon: Wallet,
        permissionKey: "lorry_expenses",
      },
      { labelKey: "nav.billing", href: "/billing", icon: ReceiptIndianRupee, permissionKey: "billing" },
      {
        labelKey: "nav.creditNotes",
        href: "/credit-notes",
        icon: FileMinus2,
        permissionKey: "credit_notes",
      },
      {
        labelKey: "nav.debitNotes",
        href: "/debit-notes",
        icon: FilePlus2,
        permissionKey: "debit_notes",
      },
      { labelKey: "nav.ledger", href: "/ledger", icon: BookOpen, permissionKey: "ledger" },
      { labelKey: "nav.reports", href: "/reports", icon: BarChart3, permissionKey: "reports" },
    ],
  },
  {
    titleKey: "nav.section.administration",
    items: [
      { labelKey: "nav.settings", href: "/settings", icon: Settings, adminOnly: true },
      { labelKey: "nav.staff", href: "/staff", icon: UserCog, adminOnly: true },
    ],
  },
];

interface SidebarProps {
  /** Controls the mobile slide-in drawer (rendered below the `lg`
   * breakpoint only). The permanent desktop `<aside>` below is
   * unaffected by this and always follows `hidden lg:flex`. */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

export default function Sidebar({ mobileOpen = false, onMobileOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isAdmin, signOut, hasPermission } = useAuth();
  const { t } = useLanguage();

  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((menu) => {
        if (menu.adminOnly) return isAdmin;
        if (!menu.permissionKey) return true;
        return hasPermission(menu.permissionKey, "view");
      }),
    }))
    .filter((section) => section.items.length > 0);

  async function handleSignOut() {
    onMobileOpenChange?.(false);
    await signOut();
    router.replace("/login");
  }

  function closeMobileNav() {
    onMobileOpenChange?.(false);
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderNavLinks(onNavigate?: () => void) {
    return visibleSections.map((section) => (
      <div key={section.titleKey} className="space-y-1">
        <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/45">
          {t(section.titleKey)}
        </p>
        {section.items.map((menu) => {
          const Icon = menu.icon;
          const active = isActive(menu.href);
          const label = t(menu.labelKey);

          return (
            <Link
              key={menu.labelKey}
              href={menu.href}
              title={label}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-black/10"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              {active && (
                <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r bg-sidebar-primary-foreground/80" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform duration-150",
                  active ? "scale-105" : "opacity-80 group-hover:opacity-100"
                )}
              />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    ));
  }

  function brandBlock(compact = false) {
    return (
      <div className={cn("flex items-center gap-3", compact ? "px-4 py-4" : "px-5 py-5")}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/15">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Transjit Express"
            className="h-9 w-9 object-contain"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-heading text-base font-semibold leading-tight tracking-tight">
            Transjit
          </h1>
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/55">
            Express TMS
          </p>
        </div>
      </div>
    );
  }

  function userFooter(onSignOut: () => void, compact = false) {
    return (
      <div className={cn("border-t border-sidebar-border", compact ? "p-4" : "p-5")}>
        <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-highlight text-sm font-semibold text-highlight-foreground">
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
      <aside className="hidden min-h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="shrink-0 border-b border-sidebar-border">{brandBlock()}</div>
        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2">{renderNavLinks()}</nav>
        {userFooter(handleSignOut)}
      </aside>

      <DialogPrimitive.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] lg:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />

          <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl outline-none lg:hidden data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
            <DialogPrimitive.Title className="sr-only">
              {t("common.navigationMenu")}
            </DialogPrimitive.Title>

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
              {renderNavLinks(closeMobileNav)}
            </nav>

            {userFooter(handleSignOut, true)}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
