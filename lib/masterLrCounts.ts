/**
 * How many saved (final) LRs use each master record — shown in the
 * Customer, Billing Party, Vehicle and Material lists. Read-only.
 *
 * An LR linked to a master (consignor_id, consignee_id, billing_party_id,
 * material_id) counts for that record. Older LRs made before those links
 * existed only carry the name, so they count by exact name (ignoring case
 * and outer spaces) — but only when exactly one final master has that
 * name, so an LR is never counted twice. Vehicles have no link column and
 * always match on the vehicle number (ignoring spaces, dashes and case).
 */

export interface LrUsageRow {
  consignorId: number | null;
  consignorName: string;
  consigneeId: number | null;
  consigneeName: string;
  billingPartyId: number | null;
  billingPartyName: string;
  materialId: number | null;
  materialName: string;
  vehicleNumber: string;
}

export interface NamedMaster {
  id: number;
  name: string;
  entryStatus?: string;
}

const nameKey = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();
export const vehicleKey = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Name → id, only for names held by exactly one final master. */
function uniqueNameIndex(masters: NamedMaster[]): Map<string, number> {
  const seen = new Map<string, number | null>();
  for (const master of masters) {
    if (master.entryStatus === "draft") continue;
    const key = nameKey(master.name);
    if (!key) continue;
    seen.set(key, seen.has(key) ? null : master.id);
  }
  const index = new Map<string, number>();
  for (const [key, id] of seen) if (id != null) index.set(key, id);
  return index;
}

function countBy(
  rows: LrUsageRow[],
  masters: NamedMaster[],
  id: (row: LrUsageRow) => number | null,
  name: (row: LrUsageRow) => string
): Map<number, number> {
  const byName = uniqueNameIndex(masters);
  const counts = new Map<number, number>();
  for (const row of rows) {
    const target = id(row) ?? byName.get(nameKey(name(row)));
    if (target != null) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

export function countCustomerLrs(rows: LrUsageRow[], customers: NamedMaster[]) {
  return {
    asConsignor: countBy(rows, customers, (r) => r.consignorId, (r) => r.consignorName),
    asConsignee: countBy(rows, customers, (r) => r.consigneeId, (r) => r.consigneeName),
  };
}

export function countBillingPartyLrs(rows: LrUsageRow[], parties: NamedMaster[]) {
  return countBy(rows, parties, (r) => r.billingPartyId, (r) => r.billingPartyName);
}

export function countMaterialLrs(rows: LrUsageRow[], materials: NamedMaster[]) {
  return countBy(rows, materials, (r) => r.materialId, (r) => r.materialName);
}

/** Keyed by vehicleKey(vehicle number). */
export function countVehicleLrs(rows: LrUsageRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = vehicleKey(row.vehicleNumber);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
