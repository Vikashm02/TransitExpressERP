"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import MasterAutocomplete, { type MasterAutocompleteOption } from "@/components/lookup/MasterAutocomplete";
import { getBidCustomerLookup, type BidCustomerLookupRow } from "@/components/services/customer.service";

interface BidCustomerAutocompleteProps {
  id: string;
  value: string;
  disabled?: boolean;
  placeholder: string;
  onSelect: (customer: BidCustomerLookupRow) => void;
  onClear: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;

function toOption(customer: BidCustomerLookupRow): MasterAutocompleteOption {
  return {
    id: customer.id,
    label: customer.name,
    description: customer.code,
    keywords: `${customer.code} ${customer.gst} ${customer.city} ${customer.address}`,
  };
}

/**
 * Bid-only Customer Master search. The database RPC authorizes Bid entry and
 * bounds the result set, so the form never relies on a full browser copy of
 * Customer Master.
 */
export default function BidCustomerAutocomplete({
  id,
  value,
  disabled,
  placeholder,
  onSelect,
  onClear,
}: BidCustomerAutocompleteProps) {
  const [customers, setCustomers] = useState<BidCustomerLookupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    // Read-only Bid details keep their snapshot text but never invoke the
    // create/edit-authorized lookup RPC.
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const requestId = ++requestIdRef.current;

    timerRef.current = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const rows = await getBidCustomerLookup(query);
          if (requestId === requestIdRef.current) setCustomers(rows);
        } catch (error) {
          // Search failure must not erase a current selected ID or submit a
          // free-text value. The normal form save path reports authorization
          // and write failures separately.
          console.error("Bid customer lookup failed", error);
          if (requestId === requestIdRef.current) setCustomers([]);
        } finally {
          if (requestId === requestIdRef.current) setLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
  }, [disabled]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <MasterAutocomplete
      id={id}
      value={value}
      disabled={disabled}
      options={customers.map(toOption)}
      loading={loading}
      onQueryChange={search}
      onSelect={(option) => {
        const customer = customers.find((row) => row.id === Number(option.id));
        if (customer) onSelect(customer);
      }}
      onClear={onClear}
      placeholder={placeholder}
      emptyMessage="No matching customer in Customer Master."
    />
  );
}
