import { supabase } from "@/lib/supabase";

export type MaterialIntelligenceWindow = "90" | "180" | "365" | "all";

export interface MaterialIntelligenceIdentity {
  material: string;
}

export interface MaterialOverview {
  totalWeight: number;
  lrCount: number;
  avgWeightPerLr: number | null;
  uniqueConsignees: number;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface MaterialTopConsignee {
  rank: number;
  consignee: string;
  weight: number;
  percentage: number;
  lrCount: number;
}

export interface MaterialTopConsigneesOther {
  weight: number;
  percentage: number;
  lrCount: number;
  consigneeCount: number;
}

export interface MaterialWeightTrendMonth {
  month: string;
  weight: number;
  lrCount: number;
  change: number | null;
  percentageChange: number | null;
  comparisonAvailable: boolean;
}

export interface MaterialConsigneeTrendShare {
  consignee: string;
  weight: number;
  percentage: number;
}

export interface MaterialConsigneeTrendMonth {
  month: string;
  totalWeight: number;
  consignees: MaterialConsigneeTrendShare[];
}

export interface MaterialMixItem {
  material: string;
  weight: number;
  percentage: number;
  tripCount: number;
}

export interface MaterialShareTrendShare {
  material: string;
  weight: number;
  percentage: number;
}

export interface MaterialShareTrendMonth {
  month: string;
  totalWeight: number;
  shares: MaterialShareTrendShare[];
}

export interface MaterialFocusConsignee {
  name: string;
  source: "param" | "auto_top" | "none" | string;
  materialMix: MaterialMixItem[];
  shareTrend: MaterialShareTrendMonth[];
  selectedMaterialShare: {
    material: string;
    weight: number;
    percentage: number;
    tripCount: number;
  } | null;
}

export interface MaterialInsight {
  id: string;
  message: string;
}

export interface MaterialRecentLr {
  lrNumber: string;
  lrDate: string;
  consignee: string;
  material: string;
  loadingWeight: number;
}

export interface MaterialIntelligenceResult {
  entityType: "material";
  identity: MaterialIntelligenceIdentity;
  window: {
    key: MaterialIntelligenceWindow | string;
    from: string | null;
    to: string | null;
    observationDays: number | null;
  };
  overview: MaterialOverview;
  topConsignees: {
    items: MaterialTopConsignee[];
    other: MaterialTopConsigneesOther | null;
  };
  weightTrend: MaterialWeightTrendMonth[];
  consigneeTrend: MaterialConsigneeTrendMonth[];
  focusConsignee: MaterialFocusConsignee;
  insights: MaterialInsight[];
  recentLrs: MaterialRecentLr[];
  meta: {
    lrCount: number;
    totalWeight: number;
    empty: boolean;
  };
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * Load Material Intelligence aggregates for an exact LR material name.
 * Server-side via get_material_intelligence (migration 055).
 * Weight metric: loading_weight. Date: lr_date.
 */
export async function getMaterialIntelligence(options: {
  materialName: string;
  window?: MaterialIntelligenceWindow;
  focusConsignee?: string | null;
}): Promise<MaterialIntelligenceResult> {
  const material = options.materialName.trim();
  const windowKey = options.window ?? "90";
  const focus = (options.focusConsignee ?? "").trim() || null;

  const { data, error } = await supabase.rpc("get_material_intelligence", {
    p_material: material,
    p_window: windowKey,
    p_focus_consignee: focus,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Material intelligence returned no data.");
  }

  const raw = data as Record<string, unknown>;
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const win = (raw.window ?? {}) as Record<string, unknown>;
  const overview = (raw.overview ?? {}) as Record<string, unknown>;
  const top = (raw.top_consignees ?? {}) as Record<string, unknown>;
  const focusRaw = (raw.focus_consignee ?? {}) as Record<string, unknown>;
  const meta = (raw.meta ?? {}) as Record<string, unknown>;

  const topItemsRaw = Array.isArray(top.items) ? top.items : [];
  const otherRaw =
    top.other && typeof top.other === "object"
      ? (top.other as Record<string, unknown>)
      : null;
  const weightTrendRaw = Array.isArray(raw.weight_trend) ? raw.weight_trend : [];
  const consigneeTrendRaw = Array.isArray(raw.consignee_trend)
    ? raw.consignee_trend
    : [];
  const mixRaw = Array.isArray(focusRaw.material_mix) ? focusRaw.material_mix : [];
  const shareTrendRaw = Array.isArray(focusRaw.share_trend)
    ? focusRaw.share_trend
    : [];
  const selectedShareRaw =
    focusRaw.selected_material_share &&
    typeof focusRaw.selected_material_share === "object"
      ? (focusRaw.selected_material_share as Record<string, unknown>)
      : null;
  const insightsRaw = Array.isArray(raw.insights) ? raw.insights : [];
  const recentRaw = Array.isArray(raw.recent_lrs) ? raw.recent_lrs : [];

  return {
    entityType: "material",
    identity: {
      material: asString(identity.material) || material,
    },
    window: {
      key: asString(win.key) || windowKey,
      from: asNullableString(win.from),
      to: asNullableString(win.to),
      observationDays: asNullableNumber(win.observation_days),
    },
    overview: {
      totalWeight: asNumber(overview.total_weight),
      lrCount: asNumber(overview.lr_count),
      avgWeightPerLr: asNullableNumber(overview.avg_weight_per_lr),
      uniqueConsignees: asNumber(overview.unique_consignees),
      periodFrom: asNullableString(overview.period_from),
      periodTo: asNullableString(overview.period_to),
    },
    topConsignees: {
      items: topItemsRaw.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          rank: asNumber(row.rank),
          consignee: asString(row.consignee),
          weight: asNumber(row.weight),
          percentage: asNumber(row.percentage),
          lrCount: asNumber(row.lr_count),
        };
      }),
      other: otherRaw
        ? {
            weight: asNumber(otherRaw.weight),
            percentage: asNumber(otherRaw.percentage),
            lrCount: asNumber(otherRaw.lr_count),
            consigneeCount: asNumber(otherRaw.consignee_count),
          }
        : null,
    },
    weightTrend: weightTrendRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        month: asString(row.month),
        weight: asNumber(row.weight),
        lrCount: asNumber(row.lr_count),
        change: asNullableNumber(row.change),
        percentageChange: asNullableNumber(row.percentage_change),
        comparisonAvailable: Boolean(row.comparison_available),
      };
    }),
    consigneeTrend: consigneeTrendRaw.map((item) => {
      const row = item as Record<string, unknown>;
      const consigneesRaw = Array.isArray(row.consignees) ? row.consignees : [];
      return {
        month: asString(row.month),
        totalWeight: asNumber(row.total_weight),
        consignees: consigneesRaw.map((c) => {
          const share = c as Record<string, unknown>;
          return {
            consignee: asString(share.consignee),
            weight: asNumber(share.weight),
            percentage: asNumber(share.percentage),
          };
        }),
      };
    }),
    focusConsignee: {
      name: asString(focusRaw.name),
      source: asString(focusRaw.source) || "none",
      materialMix: mixRaw.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          material: asString(row.material),
          weight: asNumber(row.weight),
          percentage: asNumber(row.percentage),
          tripCount: asNumber(row.trip_count),
        };
      }),
      shareTrend: shareTrendRaw.map((item) => {
        const row = item as Record<string, unknown>;
        const sharesRaw = Array.isArray(row.shares) ? row.shares : [];
        return {
          month: asString(row.month),
          totalWeight: asNumber(row.total_weight),
          shares: sharesRaw.map((s) => {
            const share = s as Record<string, unknown>;
            return {
              material: asString(share.material),
              weight: asNumber(share.weight),
              percentage: asNumber(share.percentage),
            };
          }),
        };
      }),
      selectedMaterialShare: selectedShareRaw
        ? {
            material: asString(selectedShareRaw.material) || material,
            weight: asNumber(selectedShareRaw.weight),
            percentage: asNumber(selectedShareRaw.percentage),
            tripCount: asNumber(selectedShareRaw.trip_count),
          }
        : null,
    },
    insights: insightsRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: asString(row.id),
        message: asString(row.message),
      };
    }),
    recentLrs: recentRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        lrNumber: asString(row.lr_number),
        lrDate: asString(row.lr_date),
        consignee: asString(row.consignee),
        material: asString(row.material),
        loadingWeight: asNumber(row.loading_weight),
      };
    }),
    meta: {
      lrCount: asNumber(meta.lr_count),
      totalWeight: asNumber(meta.total_weight),
      empty: Boolean(meta.empty),
    },
  };
}
