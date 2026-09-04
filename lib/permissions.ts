/**
 * Staff module permissions — capability model.
 *
 * Legacy stored levels (`none` | `view` | `create_view` | `edit`) remain
 * for backward compatibility and are derived from independent action
 * flags (migration 033): view / create / edit / delete / print / share.
 *
 * Database enforcement:
 *   - public.has_permission(key, level) — view / create_view / edit
 *   - public.has_module_action(key, action) — delete / print / share (+ same)
 */

export type PermissionLevel = "none" | "view" | "create_view" | "edit";

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "print"
  | "share";

export const PERMISSION_ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "print",
  "share",
];

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  print: "Print",
  share: "Share",
};

export interface ModuleActions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  print: boolean;
  share: boolean;
}

export const EMPTY_MODULE_ACTIONS: ModuleActions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  print: false,
  share: false,
};

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
  | "reports"
  | "notifications"
  | "consignee_intelligence";

/** Which actions make sense per module (UI only — flags still stored). */
export const MODULE_SUPPORTED_ACTIONS: Record<PermissionKey, PermissionAction[]> = {
  company: ["view", "edit"],
  customers: ["view", "create", "edit"],
  billing_parties: ["view", "create", "edit"],
  vehicle: ["view", "create", "edit"],
  material: ["view", "create", "edit"],
  lr: ["view", "create", "edit", "print", "share"],
  pod: ["view", "create", "edit"],
  delivery_challans: ["view", "create", "edit", "print", "share"],
  asn_creations: ["view", "create", "edit", "print"],
  lorry_expenses: ["view", "create", "edit"],
  billing: ["view", "create", "edit", "print", "share"],
  credit_notes: ["view", "create", "edit", "print"],
  debit_notes: ["view", "create", "edit", "print"],
  ledger: ["view", "print", "share"],
  reports: ["view", "print", "share"],
  notifications: ["view"],
  consignee_intelligence: ["view", "create"],
};

export const PERMISSION_MODULES: {
  key: PermissionKey;
  label: string;
  routePrefix?: string;
  description?: string;
}[] = [
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
  {
    key: "notifications",
    label: "Notifications",
    description: "Receive and view operational ERP notifications.",
  },
  {
    key: "consignee_intelligence",
    label: "Consignee Intelligence",
    routePrefix: "/consignee-intelligence",
    description: "Record and view consignee relationship conversations.",
  },
];

/** Derive legacy level from action flags (for DB permission_level sync). */
export function actionsToLevel(actions: ModuleActions): PermissionLevel {
  if (actions.edit) return "edit";
  if (actions.create) return "create_view";
  if (actions.view || actions.print || actions.share || actions.delete) return "view";
  return "none";
}

/** Expand a legacy level into action flags (migration backfill / defaults). */
export function levelToActions(level: PermissionLevel): ModuleActions {
  switch (level) {
    case "view":
      return { view: true, create: false, edit: false, delete: false, print: true, share: true };
    case "create_view":
      return { view: true, create: true, edit: false, delete: false, print: true, share: true };
    case "edit":
      return { view: true, create: false, edit: true, delete: false, print: true, share: true };
    default:
      return { ...EMPTY_MODULE_ACTIONS };
  }
}

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

export function meetsAction(actions: ModuleActions | undefined, action: PermissionAction): boolean {
  if (!actions) return false;
  if (action === "view") {
    return actions.view || actions.create || actions.edit;
  }
  return Boolean(actions[action]);
}

/**
 * Longest-prefix match so `/billing-parties` never resolves against
 * `/billing`'s prefix (it doesn't start with "/billing/").
 */
export function permissionKeyForPath(pathname: string): PermissionKey | null {
  let best: { key: PermissionKey; routePrefix: string } | null = null;

  for (const module of PERMISSION_MODULES) {
    if (!module.routePrefix) continue;
    const matches = pathname === module.routePrefix || pathname.startsWith(`${module.routePrefix}/`);
    if (matches && (!best || module.routePrefix.length > best.routePrefix.length)) {
      best = { key: module.key, routePrefix: module.routePrefix };
    }
  }

  return best?.key ?? null;
}

/** Preview-only document number from company running counter (does not allocate). */
export function formatNextDocumentNumber(
  prefix: string,
  prefixLength: number,
  runningNumber: number
): string {
  const next = (runningNumber ?? 0) + 1;
  const length = Math.max(prefixLength || 0, String(next).length);
  return `${prefix ?? ""}${String(next).padStart(length, "0")}`;
}
