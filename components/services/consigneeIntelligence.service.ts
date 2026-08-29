import { supabase } from "@/lib/supabase";

export type ConsigneeIntelligenceWindow = "90" | "180" | "365" | "all";

export interface ConsigneeIntelligenceIdentity {
  name: string;
  gst: string | null;
}

export interface MaterialMixItem {
  material: string;
  weight: number;
  percentage: number;
  tripCount: number;
}

export interface MaterialEvolutionShare {
  material: string;
  weight: number;
  percentage: number;
}

export interface MaterialEvolutionMonth {
  month: string;
  totalWeight: number;
  shares: MaterialEvolutionShare[];
}

export interface ConsigneeFrequency {
  lrCount: number;
  lastLrDate: string | null;
  daysSinceLast: number | null;
  averageInterval: number | null;
  medianInterval: number | null;
  typicalInterval: number | null;
  estimatedNext: string | null;
  insufficientHistory: boolean;
}

export interface DemandMonth {
  month: string;
  lrCount: number;
  weight: number;
}

export interface ConsigneeDemand {
  months: DemandMonth[];
  direction: "Increasing" | "Decreasing" | "Stable" | "Irregular" | string;
}

export interface ConsigneeRecentLr {
  lrNumber: string;
  lrDate: string;
  material: string;
  loadingWeight: number;
}

export interface ConsigneeIntelligenceResult {
  entityType: "consignee";
  identity: ConsigneeIntelligenceIdentity;
  window: {
    key: ConsigneeIntelligenceWindow | string;
    from: string | null;
    to: string | null;
  };
  materialMix: MaterialMixItem[];
  materialEvolution: MaterialEvolutionMonth[];
  frequency: ConsigneeFrequency;
  demand: ConsigneeDemand;
  recentLrs: ConsigneeRecentLr[];
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
 * Load Consignee Intelligence aggregates for an exact consignee name.
 * Server-side via get_consignee_intelligence (migration 049).
 * Does not load the full LR table into the browser.
 */
export async function getConsigneeIntelligence(options: {
  consigneeName: string;
  consigneeGst?: string | null;
  window?: ConsigneeIntelligenceWindow;
}): Promise<ConsigneeIntelligenceResult> {
  const name = options.consigneeName.trim();
  const windowKey = options.window ?? "90";
  const gst = (options.consigneeGst ?? "").trim() || null;

  const { data, error } = await supabase.rpc("get_consignee_intelligence", {
    p_consignee: name,
    p_window: windowKey,
    p_gst: gst,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Consignee intelligence returned no data.");
  }

  const raw = data as Record<string, unknown>;
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const win = (raw.window ?? {}) as Record<string, unknown>;
  const frequency = (raw.frequency ?? {}) as Record<string, unknown>;
  const demand = (raw.demand ?? {}) as Record<string, unknown>;
  const meta = (raw.meta ?? {}) as Record<string, unknown>;

  const mixRaw = Array.isArray(raw.material_mix) ? raw.material_mix : [];
  const evolutionRaw = Array.isArray(raw.material_evolution)
    ? raw.material_evolution
    : [];
  const demandMonthsRaw = Array.isArray(demand.months) ? demand.months : [];
  const recentRaw = Array.isArray(raw.recent_lrs) ? raw.recent_lrs : [];

  return {
    entityType: "consignee",
    identity: {
      name: asString(identity.name) || name,
      gst: asNullableString(identity.gst) ?? gst,
    },
    window: {
      key: asString(win.key) || windowKey,
      from: asNullableString(win.from),
      to: asNullableString(win.to),
    },
    materialMix: mixRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        material: asString(row.material),
        weight: asNumber(row.weight),
        percentage: asNumber(row.percentage),
        tripCount: asNumber(row.trip_count),
      };
    }),
    materialEvolution: evolutionRaw.map((item) => {
      const row = item as Record<string, unknown>;
      const sharesRaw = Array.isArray(row.shares) ? row.shares : [];
      return {
        month: asString(row.month),
        totalWeight: asNumber(row.total_weight),
        shares: sharesRaw.map((share) => {
          const s = share as Record<string, unknown>;
          return {
            material: asString(s.material),
            weight: asNumber(s.weight),
            percentage: asNumber(s.percentage),
          };
        }),
      };
    }),
    frequency: {
      lrCount: asNumber(frequency.lr_count),
      lastLrDate: asNullableString(frequency.last_lr_date),
      daysSinceLast: asNullableNumber(frequency.days_since_last),
      averageInterval: asNullableNumber(frequency.average_interval),
      medianInterval: asNullableNumber(frequency.median_interval),
      typicalInterval: asNullableNumber(frequency.typical_interval),
      estimatedNext: asNullableString(frequency.estimated_next),
      insufficientHistory: Boolean(frequency.insufficient_history),
    },
    demand: {
      months: demandMonthsRaw.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          month: asString(row.month),
          lrCount: asNumber(row.lr_count),
          weight: asNumber(row.weight),
        };
      }),
      direction: asString(demand.direction) || "Irregular",
    },
    recentLrs: recentRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        lrNumber: asString(row.lr_number),
        lrDate: asString(row.lr_date),
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
