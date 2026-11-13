"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/lib/supabaseFetchAll";
import type { LrUsageRow } from "@/lib/masterLrCounts";

const toId = (value: unknown) => (value == null || value === "" ? null : Number(value));
const toText = (value: unknown) => (typeof value === "string" ? value : "");

/** Every saved (final) LR, with only the columns the master LR counts need. Read-only. */
export async function getLrUsageRows(): Promise<LrUsageRow[]> {
  const data = await fetchAllPages((from, to) =>
    supabase
      .from("lrs")
      .select("id, consignor_id, consignor, consignee_id, consignee, billing_party_id, customer, material_id, material, vehicle_number")
      .eq("entry_status", "final")
      .order("id", { ascending: true })
      .range(from, to)
  );

  return (data as Record<string, unknown>[]).map((row) => ({
    consignorId: toId(row.consignor_id),
    consignorName: toText(row.consignor),
    consigneeId: toId(row.consignee_id),
    consigneeName: toText(row.consignee),
    billingPartyId: toId(row.billing_party_id),
    billingPartyName: toText(row.customer),
    materialId: toId(row.material_id),
    materialName: toText(row.material),
    vehicleNumber: toText(row.vehicle_number),
  }));
}

/**
 * LR rows for a master list's LR count columns. `null` while loading, when
 * the user cannot view LRs (the columns are then hidden — counts would be
 * wrong without LR access), or if loading fails.
 */
export function useLrUsageRows(): LrUsageRow[] | null {
  const { hasPermission } = useAuth();
  const canViewLrs = hasPermission("lr", "view");
  const [rows, setRows] = useState<LrUsageRow[] | null>(null);

  useEffect(() => {
    if (!canViewLrs) return;
    let cancelled = false;
    getLrUsageRows()
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((error) => { console.error(error); });
    return () => { cancelled = true; };
  }, [canViewLrs]);

  return canViewLrs ? rows : null;
}
