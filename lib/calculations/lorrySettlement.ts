/**
 * Shared Financials / Lorry Expenses settlement totals.
 *
 * Total Expenses (TE) includes only:
 *   Driver Advance 1/2, Diesel Advance (historical), Loading, Unloading,
 *   Detention Charges.
 *
 * Balance Payable (BP) directional rules:
 *   Driver Advance 1/2, Diesel Advance:  TE ↑  BP ↓
 *   Loading / Unloading / Detention:     TE ↑  BP ↑
 *   Hamali / Commission / Other Expense /
 *   TDS / Other Deduction / ST Chalan /
 *   Final Amount Paid:                   TE unchanged  BP ↓
 *
 * TDS: `tdsPercentage` is 0 (NIL) or 1 (1% of lorryHireAmount).
 * Balance Paid On is a date only — not used in calculations.
 */
export interface LorrySettlementInput {
  lorryHireAmount: number;
  /** Driver Advance 1 (existing `driverAdvance` column). */
  driverAdvance?: number;
  driverAdvance2?: number;
  /** Historical only — hidden from new Financials UI, still applied when present. */
  dieselAdvance?: number;
  loadingCharges?: number;
  unloadingCharges?: number;
  detentionCharges?: number;
  hamali?: number;
  commission?: number;
  otherExpense?: number;
  stChalan?: number;
  otherDeduction?: number;
  /** Actual final payment clearing remaining balance — BP ↓, TE unchanged. */
  finalAmountPaid?: number;
  /** 0 ("NIL") or 1 ("1%") — same meaning as pods.tds_percentage. */
  tdsPercentage?: number;
}

export interface LorrySettlementResult {
  /** Sum of expense types that increase Total Expenses. */
  totalExpenses: number;
  /** 1% of `lorryHireAmount` when `tdsPercentage` is 1, else 0. */
  tdsAmount: number;
  /** Lorry Hire Amount adjusted per the directional rules above. */
  balancePayable: number;
}

export function calculateLorrySettlement(input: LorrySettlementInput): LorrySettlementResult {
  const {
    lorryHireAmount,
    driverAdvance = 0,
    driverAdvance2 = 0,
    dieselAdvance = 0,
    loadingCharges = 0,
    unloadingCharges = 0,
    detentionCharges = 0,
    hamali = 0,
    commission = 0,
    otherExpense = 0,
    stChalan = 0,
    otherDeduction = 0,
    finalAmountPaid = 0,
    tdsPercentage = 0,
  } = input;

  const totalExpenses =
    driverAdvance +
    driverAdvance2 +
    dieselAdvance +
    loadingCharges +
    unloadingCharges +
    detentionCharges;

  const tdsAmount = (tdsPercentage / 100) * lorryHireAmount;

  const balancePayable =
    lorryHireAmount -
    driverAdvance -
    driverAdvance2 -
    dieselAdvance +
    loadingCharges +
    unloadingCharges +
    detentionCharges -
    hamali -
    commission -
    otherExpense -
    tdsAmount -
    otherDeduction -
    stChalan -
    finalAmountPaid;

  return { totalExpenses, tdsAmount, balancePayable };
}

/** Financials Profit/Loss = Bill Amount − Total Expenses (not Hire). */
export function calculateFinancialProfitLoss(billAmount: number, totalExpenses: number): number {
  return billAmount - totalExpenses;
}
