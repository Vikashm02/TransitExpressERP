import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { Pod } from "@/components/pod/pod.schema";
import { emitNotificationEvent } from "@/components/services/notification.service";

/** A persisted POD row. Consignor/Consignee/Vehicle Number/Driver Name/
 * From/To are intentionally NOT part of this record — they are resolved
 * live from the linked LR (via `lr.service.ts`'s `getLRs()`) wherever
 * they need to be displayed, never duplicated into this table. */
export interface PodRecord extends Pod {
  id: number;
  createdBy: string | null;
  updatedBy: string | null;
  created_at?: string;
  updated_at?: string;
}

const TABLE = "pods";
const ASSETS_BUCKET = "pod-assets";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: Pod) {
  const row = objectToSnakeCase(values);
  row.proof_url = emptyToNull(values.proofUrl);
  row.balance_paid_on = emptyToNull(values.balancePaidOn);
  return row;
}

/** Supabase returns raw snake_case columns; `id`/`created_at` pass through
 * explicitly since they live outside the `Pod` domain type. */
function fromRow(row: Record<string, unknown>): PodRecord {
  const { id, created_at, updated_at, created_by, updated_by, ...rest } = row;

  const pod = objectToCamelCase<Pod>(rest);

  if ((pod as Record<string, unknown>).proofUrl == null) {
    (pod as Record<string, unknown>).proofUrl = "";
  }

  if ((pod as Record<string, unknown>).balancePaidOn == null) {
    (pod as Record<string, unknown>).balancePaidOn = "";
  }

  return {
    ...pod,
    id: id as number,
    createdBy: (created_by as string | null) ?? null,
    updatedBy: (updated_by as string | null) ?? null,
    created_at: created_at as string | undefined,
    updated_at: updated_at as string | undefined,
  };
}

/* ==========================================================
   GET ALL PODs
========================================================== */

export async function getPods(): Promise<PodRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE POD
========================================================== */

export async function getPod(id: number): Promise<PodRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE POD
========================================================== */

function isUniqueLrViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "23505") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return msg.includes("pods_lr_number_unique") || msg.includes("duplicate key");
}

export async function createPod(values: Pod): Promise<PodRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) {
    if (isUniqueLrViolation(error)) {
      throw new Error(
        `A POD already exists for ${values.lrNumber.trim() || "this LR"}. Each LR can have only one POD.`
      );
    }
    throw error;
  }

  const record = fromRow(data);
  void emitNotificationEvent({
    ruleKey: "pod.created",
    title: `POD created for ${record.lrNumber}`,
    href: "/pod",
    payload: { podId: record.id, lrNumber: record.lrNumber },
  });
  return record;
}

export async function updatePod(id: number, values: Pod): Promise<PodRecord> {
  // `id`/`created_at` are server-owned and must never reach the update
  // payload. (The edit dialog seeds its state from the full DB record, so
  // the caller can't be trusted to have already excluded them.)
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as Pod;

  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(sanitized))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);
  void emitNotificationEvent({
    ruleKey: "pod.updated",
    title: `POD updated for ${record.lrNumber}`,
    href: "/pod",
    payload: { podId: record.id, lrNumber: record.lrNumber },
  });
  return record;
}

/* ==========================================================
   DELETE POD
   UI Delete is Admin-only (AuthProvider isAdmin / DB is_admin()).
   Also used by PodBulkUploadDialog for compensating rollback.
   Removes the POD row and best-effort cleans the proof object when
   the URL is in the pod-assets bucket and not shared.
========================================================== */

function podAssetPathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${ASSETS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0] ?? "");
  if (!path || path.includes("..") || path.startsWith("/")) return null;
  return path;
}

export async function deletePod(id: number): Promise<void> {
  const existing = await getPod(id);
  const path = podAssetPathFromPublicUrl(existing.proofUrl);

  if (path) {
    // Best-effort storage cleanup. If DELETE policy is missing, row delete
    // still proceeds so Admin is not blocked by orphaned object cleanup.
    const { error: storageError } = await supabase.storage
      .from(ASSETS_BUCKET)
      .remove([path]);
    if (storageError) {
      console.warn("POD proof storage cleanup failed:", storageError.message);
    }
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;

  void emitNotificationEvent({
    ruleKey: "pod.deleted",
    title: "POD deleted",
    body: `POD for ${existing.lrNumber} was deleted.`,
    href: "/pod",
    payload: { podId: id, lrNumber: existing.lrNumber },
  });
}

/* ==========================================================
   PROOF FILE UPLOAD
   Requires a public "pod-assets" Storage bucket to exist.
========================================================== */

export async function uploadPodProof(file: File): Promise<string> {
  const extension = file.name.split(".").pop() ?? "pdf";
  const path = `proof/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);

  void emitNotificationEvent({
    ruleKey: "pod.proof_uploaded",
    title: "POD proof uploaded",
    body: "A Proof of POD file was uploaded.",
    href: "/pod",
  });

  return data.publicUrl;
}
