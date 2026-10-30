import { supabase } from "@/lib/supabase";

/**
 * Customer / Billing Party Master → older records (migration 119).
 * The database records every saved change to a party's name, GST, address or
 * city; these calls preview and then apply (or skip) that change on older
 * LRs, DCs, POs, Bids, conversations and — only when approved — bills.
 */

export type MasterPartyType = "customer" | "billing_party";
export type MasterPartyAction = "preview" | "apply" | "apply_with_bills" | "skip";

export interface MasterPartyDetails {
  name: string;
  gst: string;
  address: string;
  city: string;
}

export interface MasterPartyChangePreview {
  partyType: MasterPartyType;
  oldValues: MasterPartyDetails;
  newValues: MasterPartyDetails;
  changed: { name: boolean; gst: boolean; address: boolean };
  lrs: number;
  deliveryChallans: number;
  purchaseOrders: number;
  bids: number;
  conversations: number;
  bills: number;
  olderLrsNotMatched: number;
}

function details(value: unknown): MasterPartyDetails {
  const v = (value ?? {}) as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === "string" ? x : "");
  return { name: text(v.name), gst: text(v.gst), address: text(v.address), city: text(v.city) };
}

/** null when nothing is waiting (or before migration 119 is applied). */
export async function previewMasterPartyChange(
  partyType: MasterPartyType,
  partyId: number
): Promise<MasterPartyChangePreview | null> {
  const { data, error } = await supabase.rpc("master_party_change", {
    p_party_type: partyType,
    p_party_id: partyId,
    p_action: "preview",
  });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  const changed = (d.changed ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => Number(x ?? 0) || 0;
  return {
    partyType,
    oldValues: details(d.oldValues),
    newValues: details(d.newValues),
    changed: { name: changed.name === true, gst: changed.gst === true, address: changed.address === true },
    lrs: n(d.lrs),
    deliveryChallans: n(d.deliveryChallans),
    purchaseOrders: n(d.purchaseOrders),
    bids: n(d.bids),
    conversations: n(d.conversations),
    bills: n(d.bills),
    olderLrsNotMatched: n(d.olderLrsNotMatched),
  };
}

export async function applyMasterPartyChange(
  partyType: MasterPartyType,
  partyId: number,
  action: Exclude<MasterPartyAction, "preview">
): Promise<void> {
  const { error } = await supabase.rpc("master_party_change", {
    p_party_type: partyType,
    p_party_id: partyId,
    p_action: action,
  });
  if (error) throw error;
}

export interface MasterPartyHistoryEntry {
  id: number;
  partyId: number;
  oldValues: MasterPartyDetails;
  newValues: MasterPartyDetails;
  includeBills: boolean;
  summary: Record<string, unknown> | null;
  appliedAt: string;
  appliedByName: string;
  undoneAt: string | null;
  undoneByName: string;
  billsUndoneAt: string | null;
  billsUndoneByName: string;
  valuesChanged: number;
}

/** Approved master updates, newest first ([] before migration 119). */
export async function getMasterPartyHistory(partyType: MasterPartyType): Promise<MasterPartyHistoryEntry[]> {
  const { data, error } = await supabase.rpc("master_party_history", { p_party_type: partyType });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    partyId: Number(r.party_id),
    oldValues: details(r.master_old),
    newValues: details(r.master_new),
    includeBills: r.include_bills === true,
    summary: (r.summary as Record<string, unknown> | null) ?? null,
    appliedAt: String(r.applied_at ?? ""),
    appliedByName: String(r.applied_by_name ?? ""),
    undoneAt: typeof r.undone_at === "string" ? r.undone_at : null,
    undoneByName: String(r.undone_by_name ?? ""),
    billsUndoneAt: typeof r.bills_undone_at === "string" ? r.bills_undone_at : null,
    billsUndoneByName: String(r.bills_undone_by_name ?? ""),
    valuesChanged: Number(r.values_changed ?? 0) || 0,
  }));
}

export interface MasterPartyUndoResult {
  valuesRestored: number;
  changedSinceAndKept: number;
}

/**
 * Creator only. "all": put back the master and every value the update changed;
 * "bills": put back only the bills (where unchanged since).
 */
export async function undoMasterPartyUpdate(updateId: number, scope: "all" | "bills"): Promise<MasterPartyUndoResult> {
  const { data, error } = await supabase.rpc("master_party_undo", { p_update_id: updateId, p_scope: scope });
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    valuesRestored: Number(d.valuesRestored ?? 0) || 0,
    changedSinceAndKept: Number(d.changedSinceAndKept ?? 0) || 0,
  };
}
