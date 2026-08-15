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
  LogOut,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { PermissionKey } from "@/lib/permissions";

const menus: {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  /** No key = always visible to any approved user (e.g. Dashboard). */
  permissionKey?: PermissionKey;
}[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Company Master",
    href: "/company",
    icon: Building2,
    permissionKey: "company",
  },
  {
    label: "Customer Master",
    href: "/customers",
    icon: Users,
    permissionKey: "customers",
  },
  {
    label: "Billing Party Master",
    href: "/billing-parties",
    icon: Banknote,
    permissionKey: "billing_parties",
  },
  {
    label: "Vehicle Master",
    href: "/vehicle",
    icon: Truck,
    permissionKey: "vehicle",
  },
  {
    label: "Material Master",
    href: "/material",
    icon: Package,
    permissionKey: "material",
  },
  {
    label: "LR Entry",
    href: "/lr",
    icon: FileText,
    permissionKey: "lr",
  },
  {
    label: "POD Entry",
    href: "/pod",
    icon: ClipboardCheck,
    permissionKey: "pod",
  },
  {
    label: "Delivery Challan",
    href: "/delivery-challans",
    icon: ScrollText,
    permissionKey: "delivery_challans",
  },
  {
    label: "ASN Creation",
    href: "/asn",
    icon: ClipboardList,
    permissionKey: "asn_creations",
  },
  {
    label: "Financials",
    href: "/lorry-expenses",
    icon: Wallet,
    permissionKey: "lorry_expenses",
  },
  {
    label: "Billing",
    href: "/billing",
    icon: ReceiptIndianRupee,
    permissionKey: "billing",
  },
  {
    label: "Credit Note",
    href: "/credit-notes",
    icon: FileMinus2,
    permissionKey: "credit_notes",
  },
  {
    label: "Debit Note",
    href: "/debit-notes",
    icon: FilePlus2,
    permissionKey: "debit_notes",
  },
  {
    label: "Ledger",
    href: "/ledger",
    icon: BookOpen,
    permissionKey: "ledger",
  },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    permissionKey: "reports",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

/** Admin-only — hidden entirely for staff, both here and via
 * `app_users` RLS if a staff account somehow requested the route
 * directly (see migration 017). */
const adminOnlyMenu = {
  label: "Staff",
  href: "/staff",
  icon: UserCog,
};

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

  const allowedMenus = menus.filter(
    (menu) => !menu.permissionKey || hasPermission(menu.permissionKey, "view")
  );
  const visibleMenus = isAdmin ? [...allowedMenus, adminOnlyMenu] : allowedMenus;

  async function handleSignOut() {
    onMobileOpenChange?.(false);
    await signOut();
    router.replace("/login");
  }

  function closeMobileNav() {
    onMobileOpenChange?.(false);
  }

  function renderNavLinks(onNavigate?: () => void) {
    return visibleMenus.map((menu) => {
      const Icon = menu.icon;
      const active = pathname === menu.href;

      return (
        <Link
          key={menu.label}
          href={menu.href}
          title={menu.label}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Icon className="h-5 w-5 shrink-0" />
          <span className="truncate">
            {menu.label}
          </span>
        </Link>
      );
    });
  }

  return (
    <>
      {/* Desktop sidebar — unchanged at >=1024px (lg). Fully hidden
       * below that so it never permanently eats into mobile content
       * width; mobile navigation is the drawer below instead. */}
      <aside className="hidden min-h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        {/* Logo */}
        <div className="flex shrink-0 items-center gap-3 border-b border-sidebar-border px-6 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-192.png"
              alt="Transjit Express"
              className="h-9 w-9 object-contain"
            />
          </div>

          <div>
            <h1 className="text-base font-semibold leading-tight">
              Transjit
            </h1>
            <p className="text-xs text-sidebar-foreground/70">
              Express TMS
            </p>
          </div>
        </div>

        {/* Menu — scrollable so Settings / Staff stay reachable when the
         * viewport is shorter than the full menu list. */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {renderNavLinks()}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-sidebar-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/15 text-sm font-semibold">
              {(profile?.displayName || "?").charAt(0).toUpperCase()}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {profile?.displayName || "..."}
              </p>
              <p className="text-xs text-sidebar-foreground/70">
                {isAdmin ? "Administrator" : "Staff"}
              </p>
            </div>

            <button
              type="button"
              title="Sign out"
              onClick={handleSignOut}
              className="shrink-0 rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile navigation drawer — same menu data/filtering as the
       * desktop sidebar above, just presented as a slide-in panel so
       * it takes zero width when closed. Only relevant below `lg`;
       * `lg:hidden` on the popup is a defensive no-op at desktop
       * widths where the drawer is never opened anyway. */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 lg:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />

          <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl outline-none lg:hidden data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
            <DialogPrimitive.Title className="sr-only">
              Navigation menu
            </DialogPrimitive.Title>

            <div className="flex items-center justify-between gap-3 border-b border-sidebar-border px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/icons/icon-192.png"
                    alt="Transjit Express"
                    className="h-9 w-9 object-contain"
                  />
                </div>

                <div>
                  <h1 className="text-base font-semibold leading-tight">
                    Transjit
                  </h1>
                  <p className="text-xs text-sidebar-foreground/70">
                    Express TMS
                  </p>
                </div>
              </div>

              <DialogPrimitive.Close
                className="shrink-0 rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {renderNavLinks(closeMobileNav)}
            </nav>

            <div className="border-t border-sidebar-border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/15 text-sm font-semibold">
                  {(profile?.displayName || "?").charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {profile?.displayName || "..."}
                  </p>
                  <p className="text-xs text-sidebar-foreground/70">
                    {isAdmin ? "Administrator" : "Staff"}
                  </p>
                </div>

                <button
                  type="button"
                  title="Sign out"
                  onClick={handleSignOut}
                  className="shrink-0 rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
