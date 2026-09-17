/**
 * Transport bid profitability — pure functions only.
 *
 * Every value here is DERIVED from bid inputs and never persisted;
 * the database stores inputs (see 079_transport_bids.sql) so history
 * can never go stale. Negative profit is a real loss and is never
 * clamped to zero — callers render it explicitly.
 */

export type BidRateBasis = "Per MT" | "Per Vehicle";
export type MarketVehicleCostBasis = "Per MT" | "Per Trip";

/**
 * A blank (missing) commercial input is never a real zero: a ₹0 quote or
 * rate is not a commercial position. All functions below therefore treat
 * non-positive quote/rate/load as missing and return null, which callers
 * render as "—". Formulas for complete positive inputs are unchanged.
 */
export interface BidEconomicsInput {
  marketVehicleQuote: number;
  marketVehicleCostBasis: MarketVehicleCostBasis;
  expectedLoadMT: number;
  bidRate: number;
  bidRateBasis: BidRateBasis | null;
  totalQuantityMT: number;
}

/**
 * Raw market quote is either a rate per MT or a fixed trip amount. This is
 * the single source of truth for converting it into a vehicle/trip cost.
 */
export function effectiveMarketVehicleCost(
  marketVehicleQuote: number,
  marketVehicleCostBasis: MarketVehicleCostBasis,
  expectedLoadMT: number
): number | null {
  if (!Number.isFinite(marketVehicleQuote) || marketVehicleQuote <= 0) return null;
  if (marketVehicleCostBasis === "Per Trip") return marketVehicleQuote;
  if (!Number.isFinite(expectedLoadMT) || expectedLoadMT <= 0) return null;
  return marketVehicleQuote * expectedLoadMT;
}

/** Derived market cost per MT, regardless of how the raw quote was entered. */
export function marketCostPerMT(
  marketVehicleQuote: number,
  marketVehicleCostBasis: MarketVehicleCostBasis,
  expectedLoadMT: number
): number | null {
  const effectiveCost = effectiveMarketVehicleCost(
    marketVehicleQuote,
    marketVehicleCostBasis,
    expectedLoadMT
  );
  if (effectiveCost === null || !Number.isFinite(expectedLoadMT) || expectedLoadMT <= 0) return null;
  return effectiveCost / expectedLoadMT;
}

/** Revenue per vehicle. For Per MT: rate × expected load. Null when missing. */
export function revenuePerVehicle(
  bidRate: number,
  bidRateBasis: BidRateBasis | null,
  expectedLoadMT: number
): number | null {
  if (!Number.isFinite(bidRate) || bidRate <= 0 || bidRateBasis === null) return null;
  if (bidRateBasis === "Per Vehicle") return bidRate;
  if (!Number.isFinite(expectedLoadMT) || expectedLoadMT <= 0) return null;
  return bidRate * expectedLoadMT;
}

/**
 * Equivalent bid rate per MT. For Per MT it is the rate itself; for
 * Per Vehicle it is rate / expected load. Null when not computable.
 */
export function equivalentRatePerMT(
  bidRate: number,
  bidRateBasis: BidRateBasis | null,
  expectedLoadMT: number
): number | null {
  if (!Number.isFinite(bidRate) || bidRate <= 0 || bidRateBasis === null) return null;
  if (bidRateBasis === "Per MT") return bidRate;
  if (!Number.isFinite(expectedLoadMT) || expectedLoadMT <= 0) return null;
  return bidRate / expectedLoadMT;
}

/** Gross profit per vehicle = revenue − market quote. May be negative (loss). */
export function grossProfitPerVehicle(
  revenuePerVehicleValue: number | null,
  marketVehicleQuote: number
): number | null {
  if (revenuePerVehicleValue === null || !Number.isFinite(marketVehicleQuote)) return null;
  return revenuePerVehicleValue - marketVehicleQuote;
}

/** Profit per MT = gross profit / expected load. May be negative. */
export function profitPerMT(
  grossProfitPerVehicleValue: number | null,
  expectedLoadMT: number
): number | null {
  if (grossProfitPerVehicleValue === null || !Number.isFinite(expectedLoadMT)) return null;
  if (expectedLoadMT <= 0) return null;
  return grossProfitPerVehicleValue / expectedLoadMT;
}

/** Margin % = gross / revenue × 100. Null when revenue is not positive. May be negative. */
export function marginPercent(
  grossProfitPerVehicleValue: number | null,
  revenuePerVehicleValue: number | null
): number | null {
  if (grossProfitPerVehicleValue === null || revenuePerVehicleValue === null) return null;
  if (!Number.isFinite(revenuePerVehicleValue) || revenuePerVehicleValue <= 0) return null;
  return (grossProfitPerVehicleValue / revenuePerVehicleValue) * 100;
}

/**
 * Raw estimated loads = total qty / expected load. Fractional values are
 * real (a 45 MT bid at 30 MT/vehicle is 1.5 loads) and must NOT be silently
 * rounded — callers display this as "Estimated Loads".
 */
export function estimatedLoadsRaw(totalQuantityMT: number, expectedLoadMT: number): number | null {
  if (!Number.isFinite(totalQuantityMT) || !Number.isFinite(expectedLoadMT)) return null;
  if (totalQuantityMT <= 0 || expectedLoadMT <= 0) return null;
  return totalQuantityMT / expectedLoadMT;
}

/**
 * Whole vehicles to actually hire. Displayed separately as
 * "Approx. Vehicles Required" — never mixed into revenue/cost math.
 */
export function estimatedWholeVehicles(estimatedLoadsRawValue: number | null): number | null {
  if (estimatedLoadsRawValue === null || !Number.isFinite(estimatedLoadsRawValue)) return null;
  if (estimatedLoadsRawValue <= 0) return null;
  return Math.ceil(estimatedLoadsRawValue);
}

export interface BidProjectTotals {
  estimatedLoadsRaw: number | null;
  estimatedWholeVehicles: number | null;
  estimatedTotalRevenue: number | null;
  estimatedTotalMarketCost: number | null;
  estimatedTotalGrossProfit: number | null;
}

/**
 * Project totals use quantity/rate economics (never the rounded-up truck
 * count): revenue = rate × total qty (via the equivalent per-MT rate),
 * cost = market cost/MT × total qty.
 */
export function projectTotals(input: BidEconomicsInput): BidProjectTotals {
  const loadsRaw = estimatedLoadsRaw(input.totalQuantityMT, input.expectedLoadMT);
  const equivRate = equivalentRatePerMT(input.bidRate, input.bidRateBasis, input.expectedLoadMT);
  const marketPerMT = marketCostPerMT(
    input.marketVehicleQuote,
    input.marketVehicleCostBasis,
    input.expectedLoadMT
  );

  if (loadsRaw === null || equivRate === null || marketPerMT === null) {
    return {
      estimatedLoadsRaw: loadsRaw,
      estimatedWholeVehicles: estimatedWholeVehicles(loadsRaw),
      estimatedTotalRevenue: null,
      estimatedTotalMarketCost: null,
      estimatedTotalGrossProfit: null,
    };
  }

  const estimatedTotalRevenue = equivRate * input.totalQuantityMT;
  const estimatedTotalMarketCost = marketPerMT * input.totalQuantityMT;
  return {
    estimatedLoadsRaw: loadsRaw,
    estimatedWholeVehicles: estimatedWholeVehicles(loadsRaw),
    estimatedTotalRevenue,
    estimatedTotalMarketCost,
    estimatedTotalGrossProfit: estimatedTotalRevenue - estimatedTotalMarketCost,
  };
}

export interface BidProfitability {
  effectiveMarketVehicleCost: number | null;
  marketCostPerMT: number | null;
  revenuePerVehicle: number | null;
  equivalentRatePerMT: number | null;
  grossProfitPerVehicle: number | null;
  profitPerMT: number | null;
  marginPercent: number | null;
  totals: BidProjectTotals;
}

/** One-call summary for forms and tables. */
export function calculateBidProfitability(input: BidEconomicsInput): BidProfitability {
  const marketPerMT = marketCostPerMT(
    input.marketVehicleQuote,
    input.marketVehicleCostBasis,
    input.expectedLoadMT
  );
  const revenue = revenuePerVehicle(input.bidRate, input.bidRateBasis, input.expectedLoadMT);
  const effectiveMarketCost = effectiveMarketVehicleCost(
    input.marketVehicleQuote,
    input.marketVehicleCostBasis,
    input.expectedLoadMT
  );
  const gross = effectiveMarketCost === null ? null : grossProfitPerVehicle(revenue, effectiveMarketCost);
  return {
    effectiveMarketVehicleCost: effectiveMarketCost,
    marketCostPerMT: marketPerMT,
    revenuePerVehicle: revenue,
    equivalentRatePerMT: equivalentRatePerMT(input.bidRate, input.bidRateBasis, input.expectedLoadMT),
    grossProfitPerVehicle: gross,
    profitPerMT: profitPerMT(gross, input.expectedLoadMT),
    marginPercent: marginPercent(gross, revenue),
    totals: projectTotals(input),
  };
}

/** Equivalent winning ₹/MT for display when expected load is available. Never stored. */
export function equivalentWinningRatePerMT(
  winningRate: number | null | undefined,
  winningRateBasis: BidRateBasis | null | undefined,
  expectedLoadMT: number
): number | null {
  if (winningRate === null || winningRate === undefined || !winningRateBasis) return null;
  return equivalentRatePerMT(winningRate, winningRateBasis, expectedLoadMT);
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return inrFormatter.format(value);
}

export function formatMT(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} MT`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}
