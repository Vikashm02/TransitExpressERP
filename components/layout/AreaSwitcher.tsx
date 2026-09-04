"use client";

import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  SUPPLIER_HOME,
  TRANSPORT_HOME,
  appAreaFromPathname,
  type AppArea,
} from "@/lib/app-area";

type AreaSwitcherLayout = "inline" | "bar";

/**
 * Top-level area switcher: TRANSPORT | SUPPLIER.
 * SUPPLIER is shown only when the user can view supplier_intelligence
 * (admins / full_access keep existing bypass semantics via hasPermission).
 *
 * layout:
 * - "inline" — compact control for desktop/tablet header row
 * - "bar" — full-width equal segments for the mobile second header row
 */
export default function AreaSwitcher({
  layout = "inline",
}: {
  layout?: AreaSwitcherLayout;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const activeArea = appAreaFromPathname(pathname);
  const canAccessSupplier = hasPermission("supplier_intelligence", "view");

  function selectArea(area: AppArea) {
    if (area === activeArea) return;
    if (area === "supplier") {
      if (!canAccessSupplier) return;
      router.push(SUPPLIER_HOME);
      return;
    }
    router.push(TRANSPORT_HOME);
  }

  return (
    <div
      role="tablist"
      aria-label="Application area"
      className={cn(
        "rounded-lg border border-border/80 bg-surface-muted/60 p-0.5",
        layout === "bar"
          ? "flex w-full min-w-0 items-stretch"
          : "inline-flex items-center",
      )}
    >
      <AreaTab
        layout={layout}
        selected={activeArea === "transport"}
        onSelect={() => selectArea("transport")}
      >
        Transport
      </AreaTab>

      {canAccessSupplier ? (
        <AreaTab
          layout={layout}
          selected={activeArea === "supplier"}
          onSelect={() => selectArea("supplier")}
        >
          Supplier
        </AreaTab>
      ) : null}
    </div>
  );
}

function AreaTab({
  layout,
  selected,
  onSelect,
  children,
}: {
  layout: AreaSwitcherLayout;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "rounded-md font-semibold tracking-[0.06em] uppercase transition-colors",
        layout === "bar"
          ? "flex min-h-11 min-w-0 flex-1 items-center justify-center whitespace-nowrap px-3 py-2.5 text-xs sm:min-h-12"
          : "px-2.5 py-1 text-[11px] sm:px-3 sm:text-xs",
        selected
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
