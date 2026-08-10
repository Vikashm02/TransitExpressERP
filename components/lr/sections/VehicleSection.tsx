"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";

import VehicleLookup from "@/components/lookup/VehicleLookup";
import TransporterLookup from "@/components/lookup/TransporterLookup";
import DriverLookup from "@/components/lookup/DriverLookup";
import type { VehicleRecord } from "@/components/services/vehicle.service";
import type { TransporterRecord } from "@/components/services/transporter.service";
import type { DriverRecord } from "@/components/services/driver.service";
import { VEHICLE_TYPE_OPTIONS } from "@/components/vehicle/vehicle.schema";

import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface VehicleSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function VehicleSection({
  lr,
  errors = {},
  onChange,
}: VehicleSectionProps) {
  const [vehicleLookupOpen, setVehicleLookupOpen] = useState(false);
  const [transporterLookupOpen, setTransporterLookupOpen] = useState(false);
  const [driverLookupOpen, setDriverLookupOpen] = useState(false);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  function handleVehicleSelect(vehicle: VehicleRecord) {
    onChange({
      ...lr,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleType: vehicle.vehicleType,
      lorryHireRate: vehicle.hireRate,
      lorryHireType: vehicle.hireType,
    });
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
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Vehicle Number"
            htmlFor="lr-vehicle-number"
            required
            error={errors.vehicleNumber}
          >
            <div className="flex gap-3">
              <Input
                id="lr-vehicle-number"
                placeholder="MH12AB1234"
                value={lr.vehicleNumber}
                onChange={(e) => update("vehicleNumber", e.target.value.toUpperCase())}
              />

              <Button
                type="button"
                variant="outline"
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
            value={lr.vehicleType}
            onValueChange={(value) => update("vehicleType", value)}
            options={toOptions(VEHICLE_TYPE_OPTIONS)}
            placeholder="Select Vehicle Type"
          />

          <FormField
            label="Transporter"
            htmlFor="lr-transporter"
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
        onSelect={handleVehicleSelect}
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
