import type { LR } from "./lr.schema";

type BillingPartySelection = { id: number; name: string };
type CustomerSelection = BillingPartySelection & { gst: string; address: string; city: string };

/** Finalization only: drafts and historical finalized rows may remain unresolved. */
export function lrPartyFinalizationError(values: Pick<LR, "customer" | "consignor" | "consignee" | "billingPartyId" | "consignorId" | "consigneeId">): string | null {
  if (values.customer.trim() !== "" && values.billingPartyId == null) {
    return "Please reselect Billing Party from Billing Party Master.";
  }
  if (values.consignor.trim() !== "" && values.consignorId == null) {
    return "Please reselect Consignor from Customer Master.";
  }
  if (values.consignee.trim() !== "" && values.consigneeId == null) {
    return "Please reselect Consignee from Customer Master.";
  }
  return null;
}

/** Never resolve IDs from snapshots. Only master lookup selections call these helpers. */
export function selectBillingParty(lr: LR, party: BillingPartySelection | null): LR {
  return { ...lr, customer: party?.name ?? "", billingPartyId: party?.id ?? null };
}

export function selectCustomerParty(lr: LR, role: "consignor" | "consignee", party: CustomerSelection | null): LR {
  return {
    ...lr,
    [role]: party?.name ?? "",
    [`${role}Id`]: party?.id ?? null,
    [`${role}GST`]: party?.gst ?? "",
    [`${role}Address`]: party?.address ?? "",
    ...(role === "consignor" ? { from: party?.city ?? "" } : { to: party?.city ?? "" }),
  };
}

/** Same display name can represent different masters. Clearing selection also clears its PO. */
export function lrPoPartyChanged(previous: LR, next: LR): boolean {
  return previous.customer !== next.customer || previous.consignor !== next.consignor
    || previous.billingPartyId !== next.billingPartyId || previous.consignorId !== next.consignorId;
}

/** Preserve missing vs explicit null: old callers must not erase existing relationships. */
export function partyIdentityColumns(values: Pick<LR, "billingPartyId" | "consignorId" | "consigneeId">): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const [key, column] of [["billingPartyId", "billing_party_id"], ["consignorId", "consignor_id"], ["consigneeId", "consignee_id"]] as const) {
    const id = values[key];
    if (id === undefined) continue;
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid LR party identity.");
    result[column] = id;
  }
  return result;
}

/** Decode bigint responses without silently rounding an authorization identity. */
export function readPartyIdentity(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return value;
  const id = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid LR party identity.");
  return id;
}
