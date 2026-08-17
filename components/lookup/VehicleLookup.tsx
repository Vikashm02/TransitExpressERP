"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import { getVehicles, type VehicleRecord } from "@/components/services/vehicle.service";
import {
  canonicalizeVehicleNumber,
  vehicleNumberMatchesQuery,
} from "@/lib/vehicleNumber";

interface VehicleLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (vehicle: VehicleRecord) => void;
}

export default function VehicleLookup({
  open,
  onClose,
  onSelect,
}: VehicleLookupProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    setLoading(true);

    getVehicles()
      .then((data) => {
        if (!cancelled) setVehicles(data);
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

  const filteredVehicles = useMemo(() => {
    const query = search.trim();

    return vehicles
      .filter(
        (vehicle) =>
          !query ||
          vehicleNumberMatchesQuery(vehicle.vehicleNumber, query) ||
          vehicle.ownerName.toLowerCase().includes(query.toLowerCase()) ||
          vehicle.mobile.toLowerCase().includes(query.toLowerCase())
      )
      .map((vehicle) => ({
        ...vehicle,
        // Show the complete registration number in canonical form when possible.
        vehicleNumber:
          canonicalizeVehicleNumber(vehicle.vehicleNumber) || vehicle.vehicleNumber,
      }));
  }, [vehicles, search]);

  return (
    <LookupDialog
      open={open}
      title="Select Vehicle"
      search={search}
      onSearchChange={setSearch}
      data={filteredVehicles}
      loading={loading}
      columns={[
        { key: "vehicleNumber", label: "Vehicle Number" },
        { key: "vehicleType", label: "Vehicle Type" },
        { key: "ownerName", label: "Owner" },
        { key: "ownerType", label: "Owner Type" },
        { key: "mobile", label: "Mobile" },
      ]}
      onSelect={(vehicle) => {
        // Pass through the original master row (lookup by id) so hire/type stay accurate.
        const original = vehicles.find((row) => row.id === vehicle.id) ?? vehicle;
        onSelect(original);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
