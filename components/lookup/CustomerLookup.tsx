"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import { getCustomers, type CustomerRecord } from "@/components/services/customer.service";

interface CustomerLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: CustomerRecord) => void;
}

export default function CustomerLookup({
  open,
  onClose,
  onSelect,
}: CustomerLookupProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    setLoading(true);

    getCustomers()
      .then((data) => {
        if (!cancelled) setCustomers(data);
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

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return customers.filter(
      (customer) =>
        !query ||
        customer.name.toLowerCase().includes(query) ||
        customer.code.toLowerCase().includes(query) ||
        customer.gst.toLowerCase().includes(query) ||
        customer.city.toLowerCase().includes(query)
    );
  }, [customers, search]);

  return (
    <LookupDialog
      open={open}
      title="Select Customer"
      search={search}
      onSearchChange={setSearch}
      data={filteredCustomers}
      loading={loading}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Customer" },
        { key: "gst", label: "GST" },
        { key: "city", label: "City" },
      ]}
      onSelect={(customer) => {
        onSelect(customer);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
