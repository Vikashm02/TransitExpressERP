"use client";

import { useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";

import {
  vehicles,
  VehicleData,
} from "@/components/data";

interface VehicleLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (vehicle: VehicleData) => void;
}

export default function VehicleLookup({
  open,
  onClose,
  onSelect,
}: VehicleLookupProps) {
  const [search, setSearch] = useState("");

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) =>
      vehicle.vehicleNumber
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  }, [search]);

  return (
    <LookupDialog
      open={open}
      title="Select Vehicle"
      search={search}
      onSearchChange={setSearch}
      data={filteredVehicles}
      columns={[
        {
          key: "vehicleNumber",
          label: "Vehicle Number",
        },
        {
          key: "vehicleType",
          label: "Vehicle Type",
        },
        {
          key: "transporter",
          label: "Transporter",
        },
        {
          key: "driverName",
          label: "Driver",
        },
      ]}
      onSelect={(vehicle) => {
        onSelect(vehicle);
        onClose();
      }}
      onClose={onClose}
    />
  );
}