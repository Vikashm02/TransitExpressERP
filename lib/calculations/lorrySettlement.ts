/**
 * Shared Lorry Expenses / settlement totals.
 *
 * Total Expenses and Balance Payable follow the approved directional
 * rules (source of truth — do not "correct" as normal accounting):
 *
 *   Driver Advance 1/2, Diesel Advance:  TE ↑  BP ↓
 *   Loading / Unloading / Detention:     TE ↑  BP ↑
 *   Hamali / Commission / Other Expense /
 *   TDS / Other Deduction / ST Chalan:   TE unchanged  BP ↓
 *
 * TDS uses the existing POD meaning: `tdsPercentage` is 0 (NIL) or 1
 * (1%), and `tdsAmount` = (tdsPercentage / 100) * lorryHireAmount.
 *
 * ST Chalan follows the prior settlement behaviour (deducted from
 * Balance Payable, not included in Total Expenses).
 */
export interface LorrySettlementInput {
  lorryHireAmount: number;
  /** Driver Advance 1 (existing `driverAdvance` column). */
  driverAdvance?: number;
  driverAdvance2?: number;
  dieselAdvance?: number;
  loadingCharges?: number;
  unloadingCharges?: number;
  detentionCharges?: number;
  hamali?: number;
  commission?: number;
  otherExpense?: number;
  stChalan?: number;
  otherDeduction?: number;
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

  // TE↑BP↓ items subtract; TE↑BP↑ items add; TE-unchanged BP↓ items subtract.
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
    stChalan;

  return { totalExpenses, tdsAmount, balancePayable };
}
