"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import { getMaterials, type MaterialRecord } from "@/components/services/material.service";

interface MaterialLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (material: MaterialRecord) => void;
}

export default function MaterialLookup({
  open,
  onClose,
  onSelect,
}: MaterialLookupProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    setLoading(true);

    getMaterials()
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
  }, [open]);

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
