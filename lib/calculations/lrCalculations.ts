import { LR } from "@/components/lr/types";

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

    case "Guaranteed Weight":
      return lr.billRate * lr.guaranteedWeight;

    default:
      return 0;
  }
}

/* ===========================================
   LORRY HIRE
=========================================== */

function calculateLorryHireAmount(lr: LR): number {
  switch (lr.lorryHireType) {
    case "Fixed":
      return lr.lorryHireRate;

    case "Per Ton":
      return lr.lorryHireRate * lr.chargedWeight;

    case "Guaranteed Weight":
      return (
        lr.lorryHireRate *
        lr.vehicleGuaranteedWeight
      );

    default:
      return 0;
  }
}

/* ===========================================
   EXPENSES
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

  const profit =
    billAmount -
    lorryHireAmount -
    totalExpense;

  return {
    billAmount,
    lorryHireAmount,
    totalExpense,
    profit,
  };
}