"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import { getBillingParties, type BillingPartyRecord } from "@/components/services/billingParty.service";

interface BillingPartyLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (billingParty: BillingPartyRecord) => void;
}

/** Mirrors `CustomerLookup` exactly, sourced from the separate Billing
 * Party Master instead of the Customer Master. */
export default function BillingPartyLookup({
  open,
  onClose,
  onSelect,
}: BillingPartyLookupProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [billingParties, setBillingParties] = useState<BillingPartyRecord[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    setLoading(true);

    getBillingParties()
      .then((data) => {
        if (!cancelled) setBillingParties(data);
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

  const filteredBillingParties = useMemo(() => {
    const query = search.trim().toLowerCase();

    return billingParties.filter(
      (billingParty) =>
        !query ||
        billingParty.name.toLowerCase().includes(query) ||
        billingParty.code.toLowerCase().includes(query) ||
        billingParty.gst.toLowerCase().includes(query) ||
        billingParty.city.toLowerCase().includes(query)
    );
  }, [billingParties, search]);

  return (
    <LookupDialog
      open={open}
      title="Select Billing Party"
      search={search}
      onSearchChange={setSearch}
      data={filteredBillingParties}
      loading={loading}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Billing Party" },
        { key: "gst", label: "GST" },
        { key: "city", label: "City" },
      ]}
      onSelect={(billingParty) => {
        onSelect(billingParty);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
