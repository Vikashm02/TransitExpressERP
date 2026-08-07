"use client";

import { useEffect, useMemo, useState } from "react";

import LookupDialog from "./LookupDialog";
import { getLicenseStatus } from "@/components/driver/driver.schema";
import { getDrivers, type DriverRecord } from "@/components/services/driver.service";

interface DriverLookupRow extends DriverRecord {
  licenseStatus: string;
}

interface DriverLookupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (driver: DriverRecord) => void;
}

export default function DriverLookup({
  open,
  onClose,
  onSelect,
}: DriverLookupProps) {
  const [search, setSearch] = useState("");
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    getDrivers()
      .then((data) => {
        if (!cancelled) setDrivers(data);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredDrivers = useMemo<DriverLookupRow[]>(() => {
    const query = search.trim().toLowerCase();

    return drivers
      .filter(
        (driver) =>
          !query ||
          driver.driverName.toLowerCase().includes(query) ||
          driver.mobile.toLowerCase().includes(query) ||
          driver.licenseNumber.toLowerCase().includes(query)
      )
      .map((driver) => ({
        ...driver,
        licenseStatus: getLicenseStatus(driver),
      }));
  }, [drivers, search]);

  return (
    <LookupDialog
      open={open}
      title="Select Driver"
      search={search}
      onSearchChange={setSearch}
      data={filteredDrivers}
      columns={[
        { key: "driverName", label: "Driver Name" },
        { key: "mobile", label: "Mobile" },
        { key: "licenseNumber", label: "License Number" },
        { key: "licenseStatus", label: "License Status" },
      ]}
      onSelect={(driver) => {
        onSelect(driver);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
