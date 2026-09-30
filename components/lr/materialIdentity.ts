import type { LR } from "./lr.schema";

/** Explicit lookup selection only. Never infer an identity from snapshot text. */
export function selectLrMaterial(lr: LR, selected: { id: number; materialName: string; unit: string }): LR {
  if (!Number.isSafeInteger(selected.id) || selected.id <= 0) throw new Error("Invalid Material identity.");
  return { ...lr, materialId: selected.id, material: selected.materialName, packageType: selected.unit || lr.packageType };
}

export function materialFinalizationError(lr: Pick<LR, "materialId">): string | null {
  return lr.materialId != null && Number.isSafeInteger(lr.materialId) && lr.materialId > 0
    ? null : "Please select Material from Material Master before finalizing this LR.";
}
