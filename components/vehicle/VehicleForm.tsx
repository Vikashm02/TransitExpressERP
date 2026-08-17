"use client";

import { useRef } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSection from "@/components/ui/FormSection";
import {
  CAPACITY_UNIT_OPTIONS,
  HIRE_TYPE_OPTIONS,
  OWNER_TYPE_OPTIONS,
  VEHICLE_STATUS_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  type Vehicle,
} from "./vehicle.schema";
import type { FieldErrors } from "@/lib/validation";
import {
  canonicalizeVehicleNumber,
  formatVehicleNumberInputChange,
} from "@/lib/vehicleNumber";
import { useControlledInputCaret } from "@/hooks/useControlledInputCaret";

interface VehicleFormProps {
  vehicle: Vehicle;
  errors?: FieldErrors<Vehicle>;
  onChange: (vehicle: Vehicle) => void;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function VehicleForm({
  vehicle,
  errors = {},
  onChange,
}: VehicleFormProps) {
  const vehicleNumberRef = useRef<HTMLInputElement>(null);
  const scheduleCaret = useControlledInputCaret(
    vehicleNumberRef,
    vehicle.vehicleNumber
  );

  function update<K extends keyof Vehicle>(key: K, value: Vehicle[K]) {
    onChange({ ...vehicle, [key]: value });
  }

  function handleVehicleNumberChange(raw: string, selectionStart: number | null) {
    const cursor = selectionStart ?? raw.length;
    const next = formatVehicleNumberInputChange(raw, cursor, vehicle.vehicleNumber);
    scheduleCaret(next.cursor);

    const el = vehicleNumberRef.current;
    if (el) {
      if (el.value !== next.value) {
        el.value = next.value;
      }
      const pos = Math.min(next.cursor, next.value.length);
      el.setSelectionRange(pos, pos);
    }

    update("vehicleNumber", next.value);
  }

  return (
    <div className="space-y-6">
      <FormSection title="Vehicle Identity">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Vehicle Number"
            htmlFor="vehicle-number"
            required
            error={errors.vehicleNumber}
          >
            <Input
              ref={vehicleNumberRef}
              id="vehicle-number"
              placeholder="TN-34MA-8373"
              value={vehicle.vehicleNumber}
              autoComplete="off"
              onChange={(e) =>
                handleVehicleNumberChange(e.target.value, e.target.selectionStart)
              }
              onBlur={() => {
                const next = canonicalizeVehicleNumber(vehicle.vehicleNumber);
                if (next && next !== vehicle.vehicleNumber) {
                  update("vehicleNumber", next);
                }
              }}
            />
          </FormField>

          <FormField
            label="RC Number"
            htmlFor="vehicle-rc-number"
            error={errors.rcNumber}
          >
            <Input
              id="vehicle-rc-number"
              placeholder="RC Number"
              value={vehicle.rcNumber}
              onChange={(e) => update("rcNumber", e.target.value)}
            />
          </FormField>

          <FormSelect
            label="Vehicle Type"
            id="vehicle-type"
            required
            error={errors.vehicleType}
            value={vehicle.vehicleType}
            onValueChange={(value) => update("vehicleType", value)}
            options={toOptions(VEHICLE_TYPE_OPTIONS)}
          />

          <FormSelect
            label="Owner Type"
            id="vehicle-owner-type"
            required
            value={vehicle.ownerType}
            onValueChange={(value) => update("ownerType", value as Vehicle["ownerType"])}
            options={toOptions(OWNER_TYPE_OPTIONS)}
          />

          <FormField
            label="Owner Name"
            htmlFor="vehicle-owner-name"
            required
            error={errors.ownerName}
          >
            <Input
              id="vehicle-owner-name"
              placeholder="Owner Name"
              value={vehicle.ownerName}
              onChange={(e) => update("ownerName", e.target.value)}
            />
          </FormField>

          <FormField
            label="Mobile Number"
            htmlFor="vehicle-mobile"
            error={errors.mobile}
          >
            <Input
              id="vehicle-mobile"
              placeholder="Mobile Number"
              value={vehicle.mobile}
              onChange={(e) => update("mobile", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Capacity">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Capacity"
            htmlFor="vehicle-capacity"
            error={errors.capacity}
          >
            <Input
              id="vehicle-capacity"
              type="number"
              min={0}
              placeholder="0"
              value={vehicle.capacity}
              onChange={(e) => update("capacity", Number(e.target.value))}
            />
          </FormField>

          <FormSelect
            label="Capacity Unit"
            id="vehicle-capacity-unit"
            value={vehicle.capacityUnit}
            onValueChange={(value) => update("capacityUnit", value as Vehicle["capacityUnit"])}
            options={toOptions(CAPACITY_UNIT_OPTIONS)}
          />
        </div>
      </FormSection>

      <FormSection title="Financial Information">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Hire Rate"
            htmlFor="vehicle-hire-rate"
            error={errors.hireRate}
          >
            <Input
              id="vehicle-hire-rate"
              type="number"
              min={0}
              placeholder="0"
              value={vehicle.hireRate}
              onChange={(e) => update("hireRate", Number(e.target.value))}
            />
          </FormField>

          <FormSelect
            label="Hire Type"
            id="vehicle-hire-type"
            value={vehicle.hireType}
            onValueChange={(value) => update("hireType", value as Vehicle["hireType"])}
            options={toOptions(HIRE_TYPE_OPTIONS)}
          />
        </div>
      </FormSection>

      <FormSection title="Technical Information">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Chassis Number"
            htmlFor="vehicle-chassis-number"
          >
            <Input
              id="vehicle-chassis-number"
              placeholder="Chassis Number"
              value={vehicle.chassisNumber}
              onChange={(e) => update("chassisNumber", e.target.value)}
            />
          </FormField>

          <FormField
            label="Engine Number"
            htmlFor="vehicle-engine-number"
          >
            <Input
              id="vehicle-engine-number"
              placeholder="Engine Number"
              value={vehicle.engineNumber}
              onChange={(e) => update("engineNumber", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Compliance & Documents">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Insurance Number"
            htmlFor="vehicle-insurance-number"
          >
            <Input
              id="vehicle-insurance-number"
              placeholder="Insurance Number"
              value={vehicle.insuranceNumber}
              onChange={(e) => update("insuranceNumber", e.target.value)}
            />
          </FormField>

          <FormDatePicker
            label="Insurance Expiry"
            id="vehicle-insurance-expiry"
            value={vehicle.insuranceExpiry}
            onChange={(value) => update("insuranceExpiry", value)}
          />

          <FormField
            label="Permit Number"
            htmlFor="vehicle-permit-number"
          >
            <Input
              id="vehicle-permit-number"
              placeholder="Permit Number"
              value={vehicle.permitNumber}
              onChange={(e) => update("permitNumber", e.target.value)}
            />
          </FormField>

          <FormDatePicker
            label="Permit Expiry"
            id="vehicle-permit-expiry"
            value={vehicle.permitExpiry}
            onChange={(value) => update("permitExpiry", value)}
          />

          <FormField
            label="Fitness Number"
            htmlFor="vehicle-fitness-number"
          >
            <Input
              id="vehicle-fitness-number"
              placeholder="Fitness Number"
              value={vehicle.fitnessNumber}
              onChange={(e) => update("fitnessNumber", e.target.value)}
            />
          </FormField>

          <FormDatePicker
            label="Fitness Expiry"
            id="vehicle-fitness-expiry"
            value={vehicle.fitnessExpiry}
            onChange={(value) => update("fitnessExpiry", value)}
          />

          <FormField
            label="PUC Number"
            htmlFor="vehicle-puc-number"
          >
            <Input
              id="vehicle-puc-number"
              placeholder="PUC Number"
              value={vehicle.pucNumber}
              onChange={(e) => update("pucNumber", e.target.value)}
            />
          </FormField>

          <FormDatePicker
            label="PUC Expiry"
            id="vehicle-puc-expiry"
            value={vehicle.pucExpiry}
            onChange={(value) => update("pucExpiry", value)}
          />
        </div>
      </FormSection>

      <FormSection title="Additional Information">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormSelect
            label="Status"
            id="vehicle-status"
            value={vehicle.status}
            onValueChange={(value) => update("status", value as Vehicle["status"])}
            options={toOptions(VEHICLE_STATUS_OPTIONS)}
          />

          <FormField
            label="Remarks"
            htmlFor="vehicle-remarks"
            className="sm:col-span-2"
          >
            <Textarea
              id="vehicle-remarks"
              placeholder="Remarks"
              value={vehicle.remarks}
              onChange={(e) => update("remarks", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>
    </div>
  );
}
