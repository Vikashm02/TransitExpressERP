"use client";

import { useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";

import {
  customers,
  CustomerData,
} from "@/components/data/customers";

interface CustomerLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: CustomerData) => void;
}

export default function CustomerLookup({
  open,
  onClose,
  onSelect,
}: CustomerLookupProps) {
  const [search, setSearch] = useState("");

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) =>
      customer.name
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  }, [search]);

  return (
    <LookupDialog
      open={open}
      title="Select Customer"
      search={search}
      onSearchChange={setSearch}
      data={filteredCustomers}
      columns={[
        {
          key: "name",
          label: "Customer",
        },
        {
          key: "gst",
          label: "GST",
        },
        {
          key: "city",
          label: "City",
        },
      ]}
      onSelect={(customer) => {
        onSelect(customer);
        onClose();
      }}
      onClose={onClose}
    />
  );
}