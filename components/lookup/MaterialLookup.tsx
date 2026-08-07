"use client";

import { useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";

import {
  materials,
  MaterialData,
} from "@/components/data/materials";

interface MaterialLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (material: MaterialData) => void;
}

export default function MaterialLookup({
  open,
  onClose,
  onSelect,
}: MaterialLookupProps) {
  const [search, setSearch] = useState("");

  const filteredMaterials = useMemo(() => {
    return materials.filter((material) =>
      material.material
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  }, [search]);

  return (
    <LookupDialog
      open={open}
      title="Select Material"
      search={search}
      onSearchChange={setSearch}
      data={filteredMaterials}
      columns={[
        {
          key: "material",
          label: "Material",
        },
        {
          key: "packageType",
          label: "Package Type",
        },
      ]}
      onSelect={(material) => {
        onSelect(material);
        onClose();
      }}
      onClose={onClose}
    />
  );
}