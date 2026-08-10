import { LR } from "@/components/lr/lr.schema";

export interface LRCalculationResult {
  billAmount: number;
  lorryHireAmount: number;
  totalExpense: number;
  profit: number;
}

/* ===========================================
   BILL AMOUNT
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
   "Guaranteed Weight" uses its own `lorryHireGuaranteedWeight` field —
   Bill Rate and Lorry Hire are separate commercial terms and are entered
   independently, even when both are "Guaranteed Weight".
=========================================== */

function calculateLorryHireAmount(lr: LR): number {
  switch (lr.lorryHireType) {
    case "Fixed":
      return lr.lorryHireRate;

    case "Per Ton":
      return lr.lorryHireRate * lr.chargedWeight;

    case "Guaranteed Weight":
      return lr.lorryHireRate * lr.lorryHireGuaranteedWeight;

    default:
      return 0;
  }
}

/* ===========================================
   EXPENSES
   Kept purely for backward compatibility with any historical LR that
   still carries values in these fields (the LR Entry form no longer
   collects them — see components/lr/sections/CommercialSection.tsx and
   the new Lorry Expenses module). `totalExpense` is still returned by
   `calculateLR()` for callers that want to display it, but per the
   approved decision it is NEVER subtracted from `profit` below, so a
   pre-existing LR's leftover expense values can't silently change its
   stored profit figure, and Lorry Expenses (tracked separately) are
   never double-counted here.
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
=========================================== */

export function calculateLR(
  lr: LR
): LRCalculationResult {
  const billAmount =
    calculateBillAmount(lr);

  const lorryHireAmount =
    calculateLorryHireAmount(lr);

  const totalExpense =
    calculateTotalExpense(lr);

  // Profit = Bill Amount - Lorry Hire Amount (approved decision — Lorry
  // Expenses are a separate, non-double-counted tracking/settlement
  // module and must not reduce LR profit).
  const profit =
    billAmount -
    lorryHireAmount;

  return {
    billAmount,
    lorryHireAmount,
    totalExpense,
    profit,
  };
}
