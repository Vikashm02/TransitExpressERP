/**
 * Client-side mirror of the permission model added by
 * database/migrations/019_add_staff_permissions.sql. This file is
 * the single source of truth for:
 *   - which permission keys exist and what a human calls each one
 *     (Sidebar nav labels, the Staff page's Edit Permissions dialog),
 *   - which route each key protects (DashboardLayout's route guard),
 *   - what each stored permission_level actually unlocks (`meetsLevel`).
 *
 * IMPORTANT — this is NOT a single continuous ranking (none < view <
 * create_view < edit) even though the four levels are stored/shown in
 * that order. "create_view" and "edit" both build on "view" but are
 * otherwise independent capability sets, not one strictly bigger than
 * the other:
 *   - create_view unlocks Create, but NOT Edit/Delete/Reassign.
 *   - edit unlocks Edit/Delete/Reassign, but does NOT also unlock
 *     Create (a staff member must be granted "edit" specifically for
 *     that, Create is not implied).
 * Treating this as one continuous ranking (a plain `indexOf(have) >=
 * indexOf(need)` comparison) is what previously made "Edit" silently
 * also unlock Create on every module — see `meetsLevel` below.
 *
 * This is a UX/navigation convenience only — the database's
 * `public.has_permission()` function (same migration) is what
 * actually protects `lrs`/`pods` data if this check is ever
 * bypassed, and currently mirrors the old flat-ranking comparison
 * (see migration 019 part C) — it needs the equivalent fix so an
 * "edit"-level LR/POD user can't still INSERT via a direct API call
 * even though the UI now hides Create for them. Every other module
 * listed here (Billing, Credit/Debit Note, Ledger, Reports, and the
 * master screens) is gated here and in DashboardLayout/Sidebar only —
 * see that migration's file header for why those tables' RLS was
 * intentionally left untouched.
 */

export type PermissionLevel = "none" | "view" | "create_view" | "edit";

export const PERMISSION_LEVELS: PermissionLevel[] = [
  "none",
  "view",
  "create_view",
  "edit",
];

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: "No Access",
  view: "View Only",
  create_view: "Create & View",
  edit: "Edit",
};

export type PermissionKey =
  | "company"
  | "customers"
  | "billing_parties"
  | "vehicle"
  | "material"
  | "lr"
  | "pod"
  | "delivery_challans"
  | "asn_creations"
  | "lorry_expenses"
  | "billing"
  | "credit_notes"
  | "debit_notes"
  | "ledger"
  | "reports";

export const PERMISSION_MODULES: { key: PermissionKey; label: string; routePrefix: string }[] = [
  { key: "company", label: "Company Master", routePrefix: "/company" },
  { key: "customers", label: "Customer Master", routePrefix: "/customers" },
  { key: "billing_parties", label: "Billing Party Master", routePrefix: "/billing-parties" },
  { key: "vehicle", label: "Vehicle Master", routePrefix: "/vehicle" },
  { key: "material", label: "Material Master", routePrefix: "/material" },
  { key: "lr", label: "LR Entry", routePrefix: "/lr" },
  { key: "pod", label: "POD Entry", routePrefix: "/pod" },
  { key: "delivery_challans", label: "Delivery Challan", routePrefix: "/delivery-challans" },
  { key: "asn_creations", label: "ASN Creation", routePrefix: "/asn" },
  { key: "lorry_expenses", label: "Financials", routePrefix: "/lorry-expenses" },
  { key: "billing", label: "Billing", routePrefix: "/billing" },
  { key: "credit_notes", label: "Credit Note", routePrefix: "/credit-notes" },
  { key: "debit_notes", label: "Debit Note", routePrefix: "/debit-notes" },
  { key: "ledger", label: "Ledger", routePrefix: "/ledger" },
  { key: "reports", label: "Reports", routePrefix: "/reports" },
];

/**
 * Capability set granted by each stored permission_level. "view" is
 * the common baseline both "create_view" and "edit" build on; beyond
 * that they are independent, not ordered — see the file header.
 */
const LEVEL_CAPABILITIES: Record<PermissionLevel, ReadonlySet<PermissionLevel>> = {
  none: new Set(),
  view: new Set(["view"]),
  create_view: new Set(["view", "create_view"]),
  edit: new Set(["view", "edit"]),
};

export function meetsLevel(have: PermissionLevel, need: PermissionLevel): boolean {
  if (need === "none") return true;
  return LEVEL_CAPABILITIES[have].has(need);
}

/**
 * Longest-prefix match so `/billing-parties` never resolves against
 * `/billing`'s prefix (it doesn't start with "/billing/").
 */
export function permissionKeyForPath(pathname: string): PermissionKey | null {
  let best: { key: PermissionKey; routePrefix: string } | null = null;

  for (const module of PERMISSION_MODULES) {
    const matches = pathname === module.routePrefix || pathname.startsWith(`${module.routePrefix}/`);
    if (matches && (!best || module.routePrefix.length > best.routePrefix.length)) {
      best = module;
    }
  }

  return best?.key ?? null;
}
