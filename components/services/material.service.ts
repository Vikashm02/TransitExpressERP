import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase } from "@/lib/caseMapping";
import type { Material } from "@/components/material/material.schema";

/** A persisted material row, as returned by Supabase (adds server-owned columns). */
export interface MaterialRecord extends Material {
  id: number;
  created_at?: string;
}

const TABLE = "materials";

/** Supabase returns raw snake_case columns; `id`/`created_at` pass through unchanged. */
function fromRow(row: Record<string, unknown>): MaterialRecord {
  const { id, created_at, ...rest } = row;

  return {
    id: id as number,
    created_at: created_at as string | undefined,
    ...objectToCamelCase<Material>(rest),
  };
}

/**
 * Business codes follow the same "MAT0001", "MAT0002", ... convention
 * already established for Customer's "C001" and Transporter's "TR001"
 * codes. Sequenced off the current row count, which is adequate for a
 * low-concurrency master data table.
 */
async function generateMaterialCode(): Promise<string> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `MAT${String(next).padStart(4, "0")}`;
}

/* ==========================================================
   GET ALL MATERIALS
========================================================== */

export async function getMaterials(): Promise<MaterialRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE MATERIAL
========================================================== */

export async function getMaterial(id: number): Promise<MaterialRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE MATERIAL
========================================================== */

export async function createMaterial(values: Material): Promise<MaterialRecord> {
  const code = values.code.trim() || (await generateMaterialCode());

  const { data, error } = await supabase
    .from(TABLE)
    .insert(objectToSnakeCase({ ...values, code }))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE MATERIAL
========================================================== */

export async function updateMaterial(
  id: number,
  values: Material
): Promise<MaterialRecord> {
  // `code` is immutable after creation — never part of the update payload.
  const { code: _code, ...updatable } = values;

  const { data, error } = await supabase
    .from(TABLE)
    .update(objectToSnakeCase(updatable))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   DELETE MATERIAL
========================================================== */

export async function deleteMaterial(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
