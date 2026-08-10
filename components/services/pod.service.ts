import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { Pod } from "@/components/pod/pod.schema";

/** A persisted POD row. Consignor/Consignee/Vehicle Number/Driver Name/
 * From/To are intentionally NOT part of this record — they are resolved
 * live from the linked LR (via `lr.service.ts`'s `getLRs()`) wherever
 * they need to be displayed, never duplicated into this table. */
export interface PodRecord extends Pod {
  id: number;
  created_at?: string;
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
  const { id, created_at, ...rest } = row;

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
    created_at: created_at as string | undefined,
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

export async function createPod(values: Pod): Promise<PodRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE POD
========================================================== */

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

  return fromRow(data);
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

  return data.publicUrl;
}
