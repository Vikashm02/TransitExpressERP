import { supabase } from "@/lib/supabase";

export type SupplyIntelligenceWindow = "90" | "180" | "365" | "custom";

export interface SupplyIntelligenceFilters {
  window: SupplyIntelligenceWindow;
  fromDate?: string | null;
  toDate?: string | null;
  material?: string | null;
  consignee?: string | null;
}

export interface SupplyNamedWeight {
  name: string;
  weight: number;
}

export interface SupplyOverview {
  totalWeight: number;
  lrCount: number;
  uniqueConsignees: number;
  uniqueMaterials: number;
  avgWeightPerLr: number | null;
  topConsignee: SupplyNamedWeight | null;
  topMaterial: SupplyNamedWeight | null;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface SupplyTopConsigneeRow {
  rank: number;
  consignee: string;
  weight: number;
  percentage: number;
  lrCount: number;
  avgWeightPerLr: number | null;
  topMaterial: string;
}

export interface SupplyTopMaterialRow {
  rank: number;
  material: string;
  weight: number;
  percentage: number;
  lrCount: number;
  avgWeightPerLr: number | null;
  uniqueConsignees: number;
}

export interface SupplyOtherRollup {
  weight: number;
  percentage: number;
  lrCount: number;
  consigneeCount?: number;
  materialCount?: number;
}

export interface SupplyMixItem {
  material: string;
  weight: number;
  percentage: number;
  tripCount: number;
}

export interface SupplyWeightTrendMonth {
  month: string;
  weight: number;
  lrCount: number;
  change: number | null;
  percentageChange: number | null;
  comparisonAvailable: boolean;
}

export interface SupplyShareItem {
  material?: string;
  consignee?: string;
  weight: number;
  percentage: number;
}

export interface SupplyShareTrendMonth {
  month: string;
  totalWeight: number;
  shares: SupplyShareItem[];
}

export interface SupplyConsigneePreference {
  topMaterial: string;
  topShare: number;
  secondMaterial: string | null;
  secondShare: number | null;
  distinctMaterials: number;
}

export interface SupplyConsigneeDetail {
  name: string;
  materialMix: SupplyMixItem[];
  preference: SupplyConsigneePreference | null;
  shareTrend: SupplyShareTrendMonth[];
  absoluteTrend: SupplyShareTrendMonth[];
  mom: SupplyWeightTrendMonth | null;
}

export interface SupplyConsigneeDistributionRow {
  rank: number;
  consignee: string;
  weight: number;
  percentage: number;
  lrCount: number;
}

export interface SupplyConcentration {
  topConsignee: string;
  topWeight: number;
  topShare: number;
  top3Share: number;
  top5Share: number;
  consigneeCount: number;
}

export interface SupplyMaterialDetail {
  name: string;
  consigneeDistribution: {
    items: SupplyConsigneeDistributionRow[];
    other: SupplyOtherRollup | null;
  };
  concentration: SupplyConcentration | null;
  weightTrend: SupplyWeightTrendMonth[];
  consigneeTrend: SupplyShareTrendMonth[];
}

export interface SupplyInsight {
  id: string;
  message: string;
}

export interface SupplyRecentLr {
  lrNumber: string;
  lrDate: string;
  consignee: string;
  material: string;
  loadingWeight: number;
}

export interface SupplyIntelligenceResult {
  window: {
    key: SupplyIntelligenceWindow | string;
    from: string | null;
    to: string | null;
    observationDays: number | null;
  };
  filters: {
    material: string;
    consignee: string;
  };
  overview: SupplyOverview;
  filterOptions: {
    materials: string[];
    consignees: string[];
  };
  topConsignees: {
    items: SupplyTopConsigneeRow[];
    other: SupplyOtherRollup | null;
  };
  topMaterials: {
    items: SupplyTopMaterialRow[];
    other: SupplyOtherRollup | null;
  };
  materialPortfolio: SupplyMixItem[];
  weightTrend: SupplyWeightTrendMonth[];
  consigneeDetail: SupplyConsigneeDetail | null;
  materialDetail: SupplyMaterialDetail | null;
  insights: SupplyInsight[];
  recentLrs: SupplyRecentLr[];
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

function asNamedWeight(value: unknown): SupplyNamedWeight | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = asString(row.name);
  if (!name) return null;
  return { name, weight: asNumber(row.weight) };
}

function asMixItems(raw: unknown): SupplyMixItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      material: asString(row.material),
      weight: asNumber(row.weight),
      percentage: asNumber(row.percentage),
      tripCount: asNumber(row.trip_count),
    };
  });
}

function asWeightTrend(raw: unknown): SupplyWeightTrendMonth[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      month: asString(row.month),
      weight: asNumber(row.weight),
      lrCount: asNumber(row.lr_count),
      change: asNullableNumber(row.change),
      percentageChange: asNullableNumber(row.percentage_change),
      comparisonAvailable: Boolean(row.comparison_available),
    };
  });
}

function asShareTrend(raw: unknown, key: "material" | "consignee"): SupplyShareTrendMonth[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    const sharesRaw = Array.isArray(row.shares) ? row.shares : [];
    return {
      month: asString(row.month),
      totalWeight: asNumber(row.total_weight),
      shares: sharesRaw.map((s) => {
        const share = s as Record<string, unknown>;
        return {
          material: key === "material" ? asString(share.material) : undefined,
          consignee: key === "consignee" ? asString(share.consignee) : undefined,
          weight: asNumber(share.weight),
          percentage: asNumber(share.percentage),
        };
      }),
    };
  });
}

function asOther(raw: unknown): SupplyOtherRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    weight: asNumber(row.weight),
    percentage: asNumber(row.percentage),
    lrCount: asNumber(row.lr_count),
    consigneeCount:
      row.consignee_count == null ? undefined : asNumber(row.consignee_count),
    materialCount:
      row.material_count == null ? undefined : asNumber(row.material_count),
  };
}

/**
 * Supply Intelligence aggregates (migration 057).
 * Weight metric: loading_weight. Date: lr_date.
 */
export async function getSupplyIntelligence(
  filters: SupplyIntelligenceFilters
): Promise<SupplyIntelligenceResult> {
  const windowKey = filters.window ?? "90";
  const material = (filters.material ?? "").trim() || null;
  const consignee = (filters.consignee ?? "").trim() || null;
  const fromDate =
    windowKey === "custom" ? (filters.fromDate || null) : null;
  const toDate = windowKey === "custom" ? (filters.toDate || null) : null;

  const { data, error } = await supabase.rpc("get_supply_intelligence", {
    p_window: windowKey,
    p_from: fromDate,
    p_to: toDate,
    p_material: material,
    p_consignee: consignee,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Supply intelligence returned no data.");
  }

  const raw = data as Record<string, unknown>;
  const win = (raw.window ?? {}) as Record<string, unknown>;
  const filt = (raw.filters ?? {}) as Record<string, unknown>;
  const overview = (raw.overview ?? {}) as Record<string, unknown>;
  const options = (raw.filter_options ?? {}) as Record<string, unknown>;
  const topC = (raw.top_consignees ?? {}) as Record<string, unknown>;
  const topM = (raw.top_materials ?? {}) as Record<string, unknown>;
  const meta = (raw.meta ?? {}) as Record<string, unknown>;
  const consigneeDetailRaw =
    raw.consignee_detail && typeof raw.consignee_detail === "object"
      ? (raw.consignee_detail as Record<string, unknown>)
      : null;
  const materialDetailRaw =
    raw.material_detail && typeof raw.material_detail === "object"
      ? (raw.material_detail as Record<string, unknown>)
      : null;

  const preferenceRaw =
    consigneeDetailRaw?.preference &&
    typeof consigneeDetailRaw.preference === "object"
      ? (consigneeDetailRaw.preference as Record<string, unknown>)
      : null;

  const concentrationRaw =
    materialDetailRaw?.concentration &&
    typeof materialDetailRaw.concentration === "object"
      ? (materialDetailRaw.concentration as Record<string, unknown>)
      : null;

  const distRaw =
    materialDetailRaw?.consignee_distribution &&
    typeof materialDetailRaw.consignee_distribution === "object"
      ? (materialDetailRaw.consignee_distribution as Record<string, unknown>)
      : null;

  return {
    window: {
      key: asString(win.key) || windowKey,
      from: asNullableString(win.from),
      to: asNullableString(win.to),
      observationDays: asNullableNumber(win.observation_days),
    },
    filters: {
      material: asString(filt.material),
      consignee: asString(filt.consignee),
    },
    overview: {
      totalWeight: asNumber(overview.total_weight),
      lrCount: asNumber(overview.lr_count),
      uniqueConsignees: asNumber(overview.unique_consignees),
      uniqueMaterials: asNumber(overview.unique_materials),
      avgWeightPerLr: asNullableNumber(overview.avg_weight_per_lr),
      topConsignee: asNamedWeight(overview.top_consignee),
      topMaterial: asNamedWeight(overview.top_material),
      periodFrom: asNullableString(overview.period_from),
      periodTo: asNullableString(overview.period_to),
    },
    filterOptions: {
      materials: Array.isArray(options.materials)
        ? options.materials.map((m) => asString(m)).filter(Boolean)
        : [],
      consignees: Array.isArray(options.consignees)
        ? options.consignees.map((c) => asString(c)).filter(Boolean)
        : [],
    },
    topConsignees: {
      items: (Array.isArray(topC.items) ? topC.items : []).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          rank: asNumber(row.rank),
          consignee: asString(row.consignee),
          weight: asNumber(row.weight),
          percentage: asNumber(row.percentage),
          lrCount: asNumber(row.lr_count),
          avgWeightPerLr: asNullableNumber(row.avg_weight_per_lr),
          topMaterial: asString(row.top_material),
        };
      }),
      other: asOther(topC.other),
    },
    topMaterials: {
      items: (Array.isArray(topM.items) ? topM.items : []).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          rank: asNumber(row.rank),
          material: asString(row.material),
          weight: asNumber(row.weight),
          percentage: asNumber(row.percentage),
          lrCount: asNumber(row.lr_count),
          avgWeightPerLr: asNullableNumber(row.avg_weight_per_lr),
          uniqueConsignees: asNumber(row.unique_consignees),
        };
      }),
      other: asOther(topM.other),
    },
    materialPortfolio: asMixItems(raw.material_portfolio),
    weightTrend: asWeightTrend(raw.weight_trend),
    consigneeDetail: consigneeDetailRaw
      ? {
          name: asString(consigneeDetailRaw.name),
          materialMix: asMixItems(consigneeDetailRaw.material_mix),
          preference: preferenceRaw
            ? {
                topMaterial: asString(preferenceRaw.top_material),
                topShare: asNumber(preferenceRaw.top_share),
                secondMaterial: asNullableString(preferenceRaw.second_material),
                secondShare: asNullableNumber(preferenceRaw.second_share),
                distinctMaterials: asNumber(preferenceRaw.distinct_materials),
              }
            : null,
          shareTrend: asShareTrend(consigneeDetailRaw.share_trend, "material"),
          absoluteTrend: asShareTrend(
            consigneeDetailRaw.absolute_trend,
            "material"
          ),
          mom: (() => {
            const m = consigneeDetailRaw.mom;
            if (!m || typeof m !== "object") return null;
            const row = m as Record<string, unknown>;
            return {
              month: asString(row.month),
              weight: asNumber(row.weight),
              lrCount: asNumber(row.lr_count),
              change: asNullableNumber(row.change),
              percentageChange: asNullableNumber(row.percentage_change),
              comparisonAvailable: Boolean(row.comparison_available),
            };
          })(),
        }
      : null,
    materialDetail: materialDetailRaw
      ? {
          name: asString(materialDetailRaw.name),
          consigneeDistribution: {
            items: (
              Array.isArray(distRaw?.items) ? distRaw!.items : []
            ).map((item) => {
              const row = item as Record<string, unknown>;
              return {
                rank: asNumber(row.rank),
                consignee: asString(row.consignee),
                weight: asNumber(row.weight),
                percentage: asNumber(row.percentage),
                lrCount: asNumber(row.lr_count),
              };
            }),
            other: asOther(distRaw?.other),
          },
          concentration: concentrationRaw
            ? {
                topConsignee: asString(concentrationRaw.top_consignee),
                topWeight: asNumber(concentrationRaw.top_weight),
                topShare: asNumber(concentrationRaw.top_share),
                top3Share: asNumber(concentrationRaw.top3_share),
                top5Share: asNumber(concentrationRaw.top5_share),
                consigneeCount: asNumber(concentrationRaw.consignee_count),
              }
            : null,
          weightTrend: asWeightTrend(materialDetailRaw.weight_trend),
          consigneeTrend: asShareTrend(
            materialDetailRaw.consignee_trend,
            "consignee"
          ),
        }
      : null,
    insights: (Array.isArray(raw.insights) ? raw.insights : []).map((item) => {
      const row = item as Record<string, unknown>;
      return { id: asString(row.id), message: asString(row.message) };
    }),
    recentLrs: (Array.isArray(raw.recent_lrs) ? raw.recent_lrs : []).map(
      (item) => {
        const row = item as Record<string, unknown>;
        return {
          lrNumber: asString(row.lr_number),
          lrDate: asString(row.lr_date),
          consignee: asString(row.consignee),
          material: asString(row.material),
          loadingWeight: asNumber(row.loading_weight),
        };
      }
    ),
    meta: {
      lrCount: asNumber(meta.lr_count),
      totalWeight: asNumber(meta.total_weight),
      empty: Boolean(meta.empty),
    },
  };
}
