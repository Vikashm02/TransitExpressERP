import { supabase } from "@/lib/supabase";

export interface OverviewPeriodMetrics {
  lrsCreated: number | null;
  lrsUpdated: number | null;
  podsCreated: number | null;
  dcsCreated: number | null;
  asnsCreated: number | null;
  /** Sum of permitted create counts (today/month standing). */
  createdTotal?: number;
}

export interface OverviewOpenQueues {
  lrDraftsCount: number | null;
  pendingPodCount: number | null;
}

export interface OverviewDraftItem {
  id: string;
  lrNumber: string;
  vehicleNumber: string;
  createdAt: string;
  updatedAt: string;
}

export interface OverviewRecentItem {
  module: "lr" | "pod" | "dc" | "asn" | string;
  id: string;
  reference: string;
  action: "created" | "updated" | string;
  at: string;
}

export interface OverviewPermissions {
  lr: boolean;
  pod: boolean;
  deliveryChallans: boolean;
  asnCreations: boolean;
}

export interface OverviewSnapshot {
  userId: string;
  from: string;
  to: string;
  permissions: OverviewPermissions;
  period: OverviewPeriodMetrics;
  open: OverviewOpenQueues;
  today: OverviewPeriodMetrics;
  month: OverviewPeriodMetrics;
  drafts: OverviewDraftItem[];
  recent: OverviewRecentItem[];
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapPeriod(raw: Record<string, unknown> | null | undefined): OverviewPeriodMetrics {
  const row = raw ?? {};
  return {
    lrsCreated: asNullableNumber(row.lrs_created),
    lrsUpdated: asNullableNumber(row.lrs_updated),
    podsCreated: asNullableNumber(row.pods_created),
    dcsCreated: asNullableNumber(row.dcs_created),
    asnsCreated: asNullableNumber(row.asns_created),
    createdTotal: asNullableNumber(row.created_total) ?? undefined,
  };
}

/** Strip DB draft vehicle placeholders for display only. */
function displayVehicleNumber(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.toUpperCase() === "DRAFT") return "";
  return trimmed;
}

/**
 * Personal Overview snapshot for the authenticated user (Phase 2a).
 * Scope is enforced by `get_overview_snapshot` via auth.uid() — no staff id.
 */
export async function getOverviewSnapshot(
  fromDate: string,
  toDate: string
): Promise<OverviewSnapshot> {
  const { data, error } = await supabase.rpc("get_overview_snapshot", {
    p_from: fromDate,
    p_to: toDate,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Overview snapshot returned no data.");
  }

  const raw = data as Record<string, unknown>;
  const permissions = (raw.permissions ?? {}) as Record<string, unknown>;
  const open = (raw.open ?? {}) as Record<string, unknown>;

  const draftsRaw = Array.isArray(raw.drafts) ? raw.drafts : [];
  const recentRaw = Array.isArray(raw.recent) ? raw.recent : [];

  return {
    userId: String(raw.user_id ?? ""),
    from: String(raw.from ?? fromDate),
    to: String(raw.to ?? toDate),
    permissions: {
      lr: Boolean(permissions.lr),
      pod: Boolean(permissions.pod),
      deliveryChallans: Boolean(permissions.delivery_challans),
      asnCreations: Boolean(permissions.asn_creations),
    },
    period: mapPeriod(raw.period as Record<string, unknown>),
    open: {
      lrDraftsCount: asNullableNumber(open.lr_drafts_count),
      pendingPodCount: asNullableNumber(open.pending_pod_count),
    },
    today: mapPeriod(raw.today as Record<string, unknown>),
    month: mapPeriod(raw.month as Record<string, unknown>),
    drafts: draftsRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        lrNumber: String(row.lr_number ?? ""),
        vehicleNumber: displayVehicleNumber(
          row.vehicle_number == null ? "" : String(row.vehicle_number)
        ),
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? row.created_at ?? ""),
      };
    }),
    recent: recentRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        module: String(row.module ?? ""),
        id: String(row.id ?? ""),
        reference: String(row.reference ?? ""),
        action: String(row.action ?? ""),
        at: String(row.at ?? ""),
      };
    }),
  };
}
