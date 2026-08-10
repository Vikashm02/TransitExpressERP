/**
 * Shared "how much is left to pay the Lorry/Transporter" formula, used
 * by both the Lorry Expenses module (primary settlement view) and the
 * POD form (live preview of the effect of ST Chalan / TDS / Any Other
 * Deduction). Kept in one place so the two screens can never drift
 * into two different formulas for the same number.
 *
 * TDS is always 1% of the LR's *calculated* Lorry Hire Amount — never
 * the customer Bill Amount, total expenses, or a manually typed figure
 * (approved decision). `tdsPercentage` is 0 ("NIL") or 1 ("1%"), never
 * a free-form percentage.
 */
export interface LorrySettlementInput {
  lorryHireAmount: number;
  driverAdvance?: number;
  dieselAdvance?: number;
  loadingCharges?: number;
  unloadingCharges?: number;
  hamali?: number;
  commission?: number;
  otherExpense?: number;
  stChalan?: number;
  otherDeduction?: number;
  /** 0 ("NIL") or 1 ("1%") — see pod.schema.ts's `tdsPercentage`. */
  tdsPercentage?: number;
}

export interface LorrySettlementResult {
  /** Sum of the 7 Lorry Expenses fields only (no POD deductions, no TDS). */
  totalExpenses: number;
  /** 1% of `lorryHireAmount` when `tdsPercentage` is 1, else 0. */
  tdsAmount: number;
  /** Everything deducted from the Lorry Hire Amount: expenses + ST Chalan + TDS + Any Other Deduction. */
  totalDeductions: number;
  /** Lorry Hire Amount minus `totalDeductions` — what's still owed to the Lorry/Transporter. */
  balancePayable: number;
}

export function calculateLorrySettlement(input: LorrySettlementInput): LorrySettlementResult {
  const {
    lorryHireAmount,
    driverAdvance = 0,
    dieselAdvance = 0,
    loadingCharges = 0,
    unloadingCharges = 0,
    hamali = 0,
    commission = 0,
    otherExpense = 0,
    stChalan = 0,
    otherDeduction = 0,
    tdsPercentage = 0,
  } = input;

  const totalExpenses =
    driverAdvance + dieselAdvance + loadingCharges + unloadingCharges + hamali + commission + otherExpense;

  const tdsAmount = (tdsPercentage / 100) * lorryHireAmount;

  const totalDeductions = totalExpenses + stChalan + tdsAmount + otherDeduction;

  const balancePayable = lorryHireAmount - totalDeductions;

  return { totalExpenses, tdsAmount, totalDeductions, balancePayable };
}
