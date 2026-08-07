"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import {
  getTransporters,
  type TransporterRecord,
} from "@/components/services/transporter.service";

interface TransporterLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (transporter: TransporterRecord) => void;
}

export default function TransporterLookup({
  open,
  onClose,
  onSelect,
}: TransporterLookupProps) {
  const [search, setSearch] = useState("");
  const [transporters, setTransporters] = useState<TransporterRecord[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    getTransporters()
      .then((data) => {
        if (!cancelled) setTransporters(data);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredTransporters = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transporters.filter(
      (transporter) =>
        !query ||
        transporter.transporterName.toLowerCase().includes(query) ||
        transporter.contactPerson.toLowerCase().includes(query) ||
        transporter.mobile.toLowerCase().includes(query)
    );
  }, [transporters, search]);

  return (
    <LookupDialog
      open={open}
      title="Select Transporter"
      search={search}
      onSearchChange={setSearch}
      data={filteredTransporters}
      columns={[
        { key: "code", label: "Code" },
        { key: "transporterName", label: "Transporter" },
        { key: "contactPerson", label: "Contact Person" },
        { key: "mobile", label: "Mobile" },
      ]}
      onSelect={(transporter) => {
        onSelect(transporter);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
