"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import {
  getMaterials,
  type MaterialRecord,
} from "@/components/services/material.service";

export type MaterialLookupItem = Pick<
  MaterialRecord,
  "id" | "code" | "materialName" | "category" | "unit" | "description" | "status"
>;

interface MaterialLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (material: MaterialLookupItem) => void;
  /**
   * Optional loader for LR restricted lookup.
   * Defaults to getMaterials() (Material Master path).
   */
  loadMaterials?: () => Promise<MaterialLookupItem[]>;
}

export default function MaterialLookup({
  open,
  onClose,
  onSelect,
  loadMaterials = getMaterials,
}: MaterialLookupProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState<MaterialLookupItem[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    setLoading(true);

    loadMaterials()
      .then((data) => {
        if (!cancelled) setMaterials(data);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, loadMaterials]);

  const filteredMaterials = useMemo(() => {
    const query = search.trim().toLowerCase();

    return materials.filter(
      (material) =>
        !query ||
        material.materialName.toLowerCase().includes(query) ||
        material.code.toLowerCase().includes(query) ||
        material.category.toLowerCase().includes(query)
    );
  }, [materials, search]);

  return (
    <LookupDialog
      open={open}
      title="Select Material"
      search={search}
      onSearchChange={setSearch}
      data={filteredMaterials}
      loading={loading}
      columns={[
        { key: "code", label: "Code" },
        { key: "materialName", label: "Material" },
        { key: "category", label: "Category" },
        { key: "unit", label: "Unit" },
      ]}
      onSelect={(material) => {
        onSelect(material);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
