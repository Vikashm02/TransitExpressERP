"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  Truck,
  FileText,
  ClipboardCheck,
  ReceiptIndianRupee,
  BookOpen,
  BarChart3,
  Settings,
} from "lucide-react";

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
    label: "Billing",
    href: "/billing",
    icon: ReceiptIndianRupee,
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

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen bg-[#0B3A67] text-white flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-blue-800">
        <Truck className="w-8 h-8" />
        <div>
          <h1 className="text-2xl font-bold">Transjit</h1>
          <p className="text-sm text-blue-200">Express TMS</p>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 mt-6 px-3">
        {menus.map((menu) => {
          const Icon = menu.icon;
          const active = pathname === menu.href;

          return (
            <Link
              key={menu.label}
              href={menu.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-all duration-200 ${
                active
                  ? "bg-white text-[#0B3A67] font-semibold shadow-md"
                  : "text-white hover:bg-blue-700"
              }`}
            >
              <Icon size={20} />
              <span>{menu.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-blue-800 p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center font-bold">
            N
          </div>
          <div>
            <p className="text-sm font-medium">Admin</p>
            <p className="text-xs text-blue-200">Administrator</p>
          </div>
        </div>
      </div>
    </aside>
  );
}