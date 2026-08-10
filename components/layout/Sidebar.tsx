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

const menus = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Company Master",
    href: "/company",
    icon: Building2,
  },
  {
    label: "Customer Master",
    href: "/customers",
    icon: Users,
  },
  {
    label: "Billing Party Master",
    href: "/billing-parties",
    icon: Banknote,
  },
  {
    label: "Vehicle Master",
    href: "/vehicle",
    icon: Truck,
  },
  {
    label: "LR Entry",
    href: "/lr",
    icon: FileText,
  },
  {
    label: "POD Entry",
    href: "/pod",
    icon: ClipboardCheck,
  },
  {
    label: "Lorry Expenses",
    href: "/lorry-expenses",
    icon: Wallet,
  },
  {
    label: "Billing",
    href: "/billing",
    icon: ReceiptIndianRupee,
  },
  {
    label: "Credit Note",
    href: "/credit-notes",
    icon: FileMinus2,
  },
  {
    label: "Debit Note",
    href: "/debit-notes",
    icon: FilePlus2,
  },
  {
    label: "Ledger",
    href: "/ledger",
    icon: BookOpen,
  },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
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
  const { profile, isAdmin, signOut } = useAuth();

  const visibleMenus = isAdmin ? [...menus, adminOnlyMenu] : menus;

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
