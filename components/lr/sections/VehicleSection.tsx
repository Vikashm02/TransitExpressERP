"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";
import { Input } from "@/components/ui/input";

import VehicleLookup from "@/components/lookup/VehicleLookup";
import VehicleNumberInput from "@/components/lookup/VehicleNumberInput";
import TransporterLookup from "@/components/lookup/TransporterLookup";
import DriverLookup from "@/components/lookup/DriverLookup";
import {
  getVehicles,
  type VehicleRecord,
} from "@/components/services/vehicle.service";
import type { TransporterRecord } from "@/components/services/transporter.service";
import type { DriverRecord } from "@/components/services/driver.service";
import { VEHICLE_TYPE_OPTIONS } from "@/components/vehicle/vehicle.schema";
import {
  canonicalizeVehicleNumber,
  normalizeVehicleNumberKey,
} from "@/lib/vehicleNumber";

import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";
import { lrFieldHelp } from "@/lib/help";

interface VehicleSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

function findExactVehicle(
  vehicles: VehicleRecord[],
  vehicleNumber: string
): VehicleRecord | undefined {
  const key = normalizeVehicleNumberKey(vehicleNumber);
  if (!key) return undefined;
  return vehicles.find(
    (vehicle) => normalizeVehicleNumberKey(vehicle.vehicleNumber) === key
  );
}

export default function VehicleSection({
  lr,
  errors = {},
  onChange,
}: VehicleSectionProps) {
  const [vehicleLookupOpen, setVehicleLookupOpen] = useState(false);
  const [transporterLookupOpen, setTransporterLookupOpen] = useState(false);
  const [driverLookupOpen, setDriverLookupOpen] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [newVehicleHint, setNewVehicleHint] = useState(false);
  /** Avoid re-applying the same master row and wiping user edits on blur. */
  const lastAppliedKeyRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    setVehiclesLoading(true);
    getVehicles()
      .then((data) => {
        if (!cancelled) setVehicles(data);
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  function applyVehicle(vehicle: VehicleRecord) {
    const vehicleNumber =
      canonicalizeVehicleNumber(vehicle.vehicleNumber) || vehicle.vehicleNumber;
    const key = normalizeVehicleNumberKey(vehicleNumber);
    lastAppliedKeyRef.current = key;
    setNewVehicleHint(false);
    onChange({
      ...lr,
      vehicleNumber,
      vehicleType: vehicle.vehicleType || lr.vehicleType,
      transporter: vehicle.transporter || "",
      driverName: vehicle.driverName || "",
      driverMobile: vehicle.driverMobile || "",
      lorryHireRate: vehicle.hireRate,
      lorryHireType: vehicle.hireType,
    });
  }

  function handleVehicleNumberChange(vehicleNumber: string) {
    const key = normalizeVehicleNumberKey(vehicleNumber);
    if (!key || key !== lastAppliedKeyRef.current) {
      lastAppliedKeyRef.current = "";
    }

    const match = findExactVehicle(vehicles, vehicleNumber);
    if (match && key && key === normalizeVehicleNumberKey(match.vehicleNumber)) {
      if (lastAppliedKeyRef.current !== key) {
        applyVehicle(match);
        return;
      }
    }

    setNewVehicleHint(Boolean(key) && !match);
    update("vehicleNumber", vehicleNumber);
  }

  function handleTransporterSelect(transporter: TransporterRecord) {
    update("transporter", transporter.transporterName);
  }

  function handleDriverSelect(driver: DriverRecord) {
    onChange({
      ...lr,
      driverName: driver.driverName,
      driverMobile: driver.mobile,
    });
  }

  return (
    <>
      <FormSection
        title="Vehicle & Route Details"
        subtitle="Vehicle, transporter and driver assigned to this shipment"
        contentClassName="md:[&_[data-slot=input]]:text-base md:[&_[data-slot=select-trigger]]:text-base md:[&_[data-slot=select-trigger]]:w-full"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Vehicle Number"
            htmlFor="lr-vehicle-number"
            required
            error={errors.vehicleNumber}
            helpText={lrFieldHelp.vehicleNumber}
            hint={
              newVehicleHint
                ? "यह नया vehicle है। Details भरें; save करने के बाद यह Vehicle Master में automatically save हो जाएगा।"
                : undefined
            }
            className="md:col-span-2 lg:col-span-3"
          >
            <div className="flex min-w-0 gap-3">
              <VehicleNumberInput
                id="lr-vehicle-number"
                className="min-w-0 flex-1"
                value={lr.vehicleNumber}
                vehicles={vehicles}
                loading={vehiclesLoading}
                onChange={handleVehicleNumberChange}
                onSelectVehicle={applyVehicle}
              />

              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setVehicleLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </FormField>

          <FormSelect
            label="Vehicle Type"
            id="lr-vehicle-type"
            error={errors.vehicleType}
            helpText={lrFieldHelp.vehicleType}
            value={lr.vehicleType}
            onValueChange={(value) => update("vehicleType", value)}
            options={toOptions(VEHICLE_TYPE_OPTIONS)}
            placeholder="Select Vehicle Type"
            triggerClassName="md:w-full md:text-base"
          />

          <FormField
            label="Transporter"
            htmlFor="lr-transporter"
            helpText={lrFieldHelp.transporter}
          >
            <div className="flex gap-3">
              <Input
                id="lr-transporter"
                placeholder="Transporter Name"
                value={lr.transporter}
                onChange={(e) => update("transporter", e.target.value)}
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setTransporterLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </FormField>

          <FormField
            label="Driver Name"
            htmlFor="lr-driver-name"
            required
            error={errors.driverName}
            helpText={lrFieldHelp.driverName}
          >
            <div className="flex gap-3">
              <Input
                id="lr-driver-name"
                placeholder="Driver Name"
                value={lr.driverName}
                onChange={(e) => update("driverName", e.target.value)}
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setDriverLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </FormField>

          <FormField
            label="Driver Mobile"
            htmlFor="lr-driver-mobile"
            required
            error={errors.driverMobile}
            helpText={lrFieldHelp.driverMobile}
          >
            <Input
              id="lr-driver-mobile"
              placeholder="9876543210"
              value={lr.driverMobile}
              onChange={(e) => update("driverMobile", e.target.value)}
            />
          </FormField>

          <FormField
            label="From"
            htmlFor="lr-from"
            required
            error={errors.from}
          >
            <Input
              id="lr-from"
              placeholder="Loading Station"
              value={lr.from}
              onChange={(e) => update("from", e.target.value)}
            />
          </FormField>

          <FormField
            label="To"
            htmlFor="lr-to"
            required
            error={errors.to}
          >
            <Input
              id="lr-to"
              placeholder="Destination"
              value={lr.to}
              onChange={(e) => update("to", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <VehicleLookup
        open={vehicleLookupOpen}
        onClose={() => setVehicleLookupOpen(false)}
        onSelect={applyVehicle}
      />

      <TransporterLookup
        open={transporterLookupOpen}
        onClose={() => setTransporterLookupOpen(false)}
        onSelect={handleTransporterSelect}
      />

      <DriverLookup
        open={driverLookupOpen}
        onClose={() => setDriverLookupOpen(false)}
        onSelect={handleDriverSelect}
      />
    </>
  );
}
