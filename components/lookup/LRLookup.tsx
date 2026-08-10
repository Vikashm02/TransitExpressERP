"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import { getLRs, type LRRecord } from "@/components/services/lr.service";

interface LRLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (lr: LRRecord) => void;
}

export default function LRLookup({
  open,
  onClose,
  onSelect,
}: LRLookupProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [lrs, setLrs] = useState<LRRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getLRs()
      .then((data) => { if (!cancelled) setLrs(data); })
      .catch((error) => { console.error(error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const filteredLRs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lrs.filter(
      (lr) =>
        !query ||
        lr.lrNumber.toLowerCase().includes(query) ||
        lr.consignor.toLowerCase().includes(query) ||
        lr.consignee.toLowerCase().includes(query) ||
        lr.vehicleNumber.toLowerCase().includes(query)
    );
  }, [lrs, search]);

  return (
    <LookupDialog
      open={open}
      title="Select LR"
      search={search}
      onSearchChange={setSearch}
      data={filteredLRs}
      loading={loading}
      columns={[
        { key: "lrNumber", label: "LR Number" },
        { key: "consignor", label: "Consignor" },
        { key: "consignee", label: "Consignee" },
        { key: "vehicleNumber", label: "Vehicle Number" },
      ]}
      onSelect={(lr) => {
        onSelect(lr);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
