import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { Material } from "@/components/material/material.schema";

/** A persisted material row, as returned by Supabase (adds server-owned columns). */
export interface MaterialRecord extends Material {
  id: number;
  canonicalMaterialId?: number | null;
  created_at?: string;
}

export interface MaterialDescriptionRecord {
  id: number;
  materialId: number;
  description: string;
  active: boolean;
  sortOrder: number;
}

const TABLE = "materials";

/**
 * Supabase returns raw snake_case columns; `id`/`created_at` pass through
 * unchanged. The DB column is `material_code` (not `code`) — the generic
 * camelCase mapper would otherwise surface it as `materialCode`, leaving
 * `Material.code` (and the table's "Material Code" column) permanently
 * `undefined`. Renamed explicitly here, at the one boundary that needs it.
 */
function fromRow(row: Record<string, unknown>): MaterialRecord {
  const { id, created_at, material_code, ...rest } = row;

  return {
    id: id as number,
    created_at: created_at as string | undefined,
    code: material_code as string,
    ...objectToCamelCase<Omit<Material, "code">>(rest),
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

export async function getMaterials(options: { includeInactive?: boolean } = {}): Promise<MaterialRecord[]> {
  let query = supabase
    .from(TABLE)
    .select("*")
    .is("canonical_material_id", null)
    .order("created_at", { ascending: false });

  if (!options.includeInactive) query = query.eq("status", "Active");

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/**
 * Restricted Material lookup for LR Create/Edit only.
 * Uses get_lr_material_lookup (migration 053) — requires lr create/edit,
 * NOT material:view. Does not replace getMaterials() / Master.
 */
export type LrMaterialLookupRow = Pick<
  MaterialRecord,
  "id" | "code" | "materialName" | "category" | "unit" | "description" | "status"
> & {
  recommendedDescriptions: string[];
};

export async function getLrMaterialLookup(): Promise<LrMaterialLookupRow[]> {
  const { data, error } = await supabase.rpc("get_lr_material_lookup");

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows.map((item) => {
    const row = item as Record<string, unknown>;
    const status = row.status === "Inactive" ? "Inactive" : "Active";
    return {
      id: Number(row.id),
      code: String(row.material_code ?? ""),
      materialName: String(row.material_name ?? ""),
      category: String(row.category ?? ""),
      unit: String(row.unit ?? ""),
      description: String(row.description ?? ""),
      status,
      recommendedDescriptions: Array.isArray(row.recommended_descriptions)
        ? row.recommended_descriptions.map((value) => String(value))
        : [],
    };
  });
}

export async function getMaterialDescriptions(materialId: number): Promise<MaterialDescriptionRecord[]> {
  const { data, error } = await supabase
    .from("material_descriptions")
    .select("id, material_id, description, active, sort_order")
    .eq("material_id", materialId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    materialId: Number(row.material_id),
    description: String(row.description),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

export async function createMaterialDescription(materialId: number, description: string): Promise<void> {
  const { error } = await supabase.from("material_descriptions").insert({
    material_id: materialId,
    description: description.trim(),
    active: true,
  });
  if (error) throw error;
}

export async function updateMaterialDescription(
  id: number,
  patch: Pick<MaterialDescriptionRecord, "description" | "active" | "sortOrder">
): Promise<void> {
  const { error } = await supabase.from("material_descriptions").update({
    description: patch.description.trim(),
    active: patch.active,
    sort_order: patch.sortOrder,
  }).eq("id", id);
  if (error) throw error;
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
  // `code` must land in the `material_code` column, not a nonexistent
  // `code` column — rename before the generic camelCase->snake_case pass.
  const { code: _code, ...withoutCode } = values;

  const { data, error } = await supabase
    .from(TABLE)
    .insert(objectToSnakeCase({ ...withoutCode, materialCode: code }))
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
  // `code` is immutable after creation, and `id`/`created_at` are
  // server-owned — none of the three may ever reach the update payload.
  // (Edit dialogs seed their state from the full DB record, so callers
  // can't be trusted to have already excluded the server-owned fields.)
  const { code: _code, ...updatable } = omitServerFields(
    values as unknown as Record<string, unknown>
  );

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
