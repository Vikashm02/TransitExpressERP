"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  Banknote,
  Truck,
  FileText,
  ClipboardCheck,
  ReceiptIndianRupee,
  FileMinus2,
  FilePlus2,
  BookOpen,
  BarChart3,
  Settings,
  Wallet,
  UserCog,
  LogOut,
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
    label: "Lorry Expenses",
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

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isAdmin, signOut, hasPermission } = useAuth();

  const allowedMenus = menus.filter(
    (menu) => !menu.permissionKey || hasPermission(menu.permissionKey, "view")
  );
  const visibleMenus = isAdmin ? [...allowedMenus, adminOnlyMenu] : allowedMenus;

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="flex min-h-screen w-16 shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:w-64">
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-3 py-5 lg:px-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-foreground/10">
          <Truck className="h-5 w-5" />
        </div>

        <div className="hidden lg:block">
          <h1 className="text-base font-semibold leading-tight">
            Transjit
          </h1>
          <p className="text-xs text-sidebar-foreground/70">
            Express TMS
          </p>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 space-y-1 px-2 py-4 lg:px-3">
        {visibleMenus.map((menu) => {
          const Icon = menu.icon;
          const active = pathname === menu.href;

          return (
            <Link
              key={menu.label}
              href={menu.href}
              title={menu.label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="hidden truncate lg:inline">
                {menu.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3 lg:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/15 text-sm font-semibold">
            {(profile?.displayName || "?").charAt(0).toUpperCase()}
          </div>

          <div className="hidden min-w-0 flex-1 lg:block">
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
            className="hidden shrink-0 rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:block"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
