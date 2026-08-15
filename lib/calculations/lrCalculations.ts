import { LR } from "@/components/lr/lr.schema";

export interface LRCalculationResult {
  billAmount: number;
  lorryHireAmount: number;
  totalExpense: number;
  profit: number;
}

/**
 * Truncate (not round) a weight to one decimal place for Lorry Hire
 * Per Ton calculations only. Example: 22.680 → 22.6, 22.920 → 22.9.
 * Billing and all other calculations must continue using full weights.
 */
export function truncateWeightToOneDecimal(weight: number): number {
  if (!Number.isFinite(weight) || weight === 0) return 0;
  const scaled = weight * 10;
  // Small epsilon absorbs binary float noise so 22.9 does not become 22.8.
  return Math.floor(scaled + 1e-9) / 10;
}

/* ===========================================
   BILL AMOUNT — full weights (no truncation)
=========================================== */

function calculateBillAmount(lr: LR): number {
  switch (lr.billRateType) {
    case "Fixed":
      return lr.billRate;

    case "Per Ton (Loading)":
      return lr.billRate * lr.loadingWeight;

    case "Per Ton (Unloading)":
      return lr.billRate * lr.unloadingWeight;

    case "Guaranteed Weight":
      return lr.billRate * lr.guaranteedWeight;

    default:
      return 0;
  }
}

/* ===========================================
   LORRY HIRE
   Per Ton (Loading/Unloading) use weight truncated to 1 decimal.
   Guaranteed Weight / Fixed / legacy Per Ton unchanged otherwise.
=========================================== */

function calculateLorryHireAmount(lr: LR): number {
  switch (lr.lorryHireType) {
    case "Fixed":
      return lr.lorryHireRate;

    case "Per Ton (Loading)":
      return lr.lorryHireRate * truncateWeightToOneDecimal(lr.loadingWeight);

    case "Per Ton (Unloading)":
      return lr.lorryHireRate * truncateWeightToOneDecimal(lr.unloadingWeight);

    case "Guaranteed Weight":
      return lr.lorryHireRate * lr.lorryHireGuaranteedWeight;

    // Legacy stored value from older LRs / Vehicle Master "Per Ton".
    case "Per Ton":
      return lr.lorryHireRate * lr.chargedWeight;

    default:
      return 0;
  }
}

/* ===========================================
   EXPENSES (legacy LR columns — not Financials TE)
=========================================== */

function calculateTotalExpense(lr: LR): number {
  return (
    lr.driverAdvance +
    lr.dieselAdvance +
    lr.stChallan +
    lr.loadingCharges +
    lr.unloadingCharges +
    lr.hamali +
    lr.commission +
    lr.otherExpense
  );
}

/* ===========================================
   MAIN CALCULATION
   Stored LR `profit` remains Bill − Hire (unchanged persistence meaning).
   Financials UI Profit/Loss uses Bill − settlement Total Expenses instead.
=========================================== */

export function calculateLR(lr: LR): LRCalculationResult {
  const billAmount = calculateBillAmount(lr);
  const lorryHireAmount = calculateLorryHireAmount(lr);
  const totalExpense = calculateTotalExpense(lr);
  const profit = billAmount - lorryHireAmount;

  return {
    billAmount,
    lorryHireAmount,
    totalExpense,
    profit,
  };
}
