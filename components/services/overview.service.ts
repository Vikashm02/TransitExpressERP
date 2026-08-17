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

/** Open-queue age buckets (not filtered by reporting period). */
export interface OverviewAgeBuckets {
  today: number;
  days12: number;
  days37: number;
  days7Plus: number;
  oldestDays: number | null;
  total: number;
}

/**
 * Period: LRs created in selected range with finalized_at set.
 * Duration uses finalized_at − created_at (never updated_at).
 */
export interface OverviewCompletionMetrics {
  completedCount: number;
  /** Average seconds; null when no completed LRs. */
  avgSeconds: number | null;
}

/**
 * Period: LRs created by user in selected range.
 * Edits: all tracked lr_edit_events on those LRs (may be after period end).
 * Scores are null when lrsCreated === 0 (show "No data").
 */
export interface OverviewQualityMetrics {
  lrsCreated: number;
  totalEdits: number;
  editRate: number | null;
  qualityScore: number | null;
  trackingStartedAt: string | null;
}

export interface OverviewEfficiency {
  draftAge: OverviewAgeBuckets;
  pendingPodAge: OverviewAgeBuckets;
  completion: OverviewCompletionMetrics;
  quality: OverviewQualityMetrics;
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
  /** Null when caller lacks LR view permission (or pre-038 RPC). */
  efficiency: OverviewEfficiency | null;
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

function mapAgeBuckets(raw: Record<string, unknown> | null | undefined): OverviewAgeBuckets {
  const row = raw ?? {};
  return {
    today: asNullableNumber(row.today) ?? 0,
    days12: asNullableNumber(row.days_1_2) ?? 0,
    days37: asNullableNumber(row.days_3_7) ?? 0,
    days7Plus: asNullableNumber(row.days_7_plus) ?? 0,
    oldestDays: asNullableNumber(row.oldest_days),
    total: asNullableNumber(row.total) ?? 0,
  };
}

function mapEfficiency(raw: unknown): OverviewEfficiency | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const completion = (row.completion ?? {}) as Record<string, unknown>;
  const quality = (row.quality ?? {}) as Record<string, unknown>;

  return {
    draftAge: mapAgeBuckets(row.draft_age as Record<string, unknown>),
    pendingPodAge: mapAgeBuckets(row.pending_pod_age as Record<string, unknown>),
    completion: {
      completedCount: asNullableNumber(completion.completed_count) ?? 0,
      avgSeconds: asNullableNumber(completion.avg_seconds),
    },
    quality: {
      lrsCreated: asNullableNumber(quality.lrs_created) ?? 0,
      totalEdits: asNullableNumber(quality.total_edits) ?? 0,
      editRate: asNullableNumber(quality.edit_rate),
      qualityScore: asNullableNumber(quality.quality_score),
      trackingStartedAt:
        quality.tracking_started_at == null
          ? null
          : String(quality.tracking_started_at),
    },
  };
}

/** Strip DB draft vehicle placeholders for display only. */
function displayVehicleNumber(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.toUpperCase() === "DRAFT") return "";
  return trimmed;
}

/**
 * Personal Overview snapshot for the authenticated user.
 * Scope is enforced by `get_overview_snapshot` via auth.uid() — no staff id.
 * Efficiency block requires migration 038.
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
    efficiency: mapEfficiency(raw.efficiency),
  };
}
