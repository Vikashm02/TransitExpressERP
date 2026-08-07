"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSection from "@/components/ui/FormSection";
import {
  DRIVER_STATUS_OPTIONS,
  DRIVER_TYPE_OPTIONS,
  LICENSE_TYPE_OPTIONS,
  type Driver,
} from "./driver.schema";
import type { FieldErrors } from "@/lib/validation";

interface DriverFormProps {
  driver: Driver;
  errors?: FieldErrors<Driver>;
  onChange: (driver: Driver) => void;
  onUploadPhoto: (file: File) => void;
  uploadingPhoto?: boolean;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function DriverForm({
  driver,
  errors = {},
  onChange,
  onUploadPhoto,
  uploadingPhoto = false,
}: DriverFormProps) {
  function update<K extends keyof Driver>(key: K, value: Driver[K]) {
    onChange({ ...driver, [key]: value });
  }

  return (
    <div className="space-y-6">
      <FormSection title="Identity">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Driver Name"
            htmlFor="driver-name"
            required
            error={errors.driverName}
          >
            <Input
              id="driver-name"
              placeholder="Driver Name"
              value={driver.driverName}
              onChange={(e) => update("driverName", e.target.value)}
            />
          </FormField>

          <FormSelect
            label="Driver Type"
            id="driver-type"
            required
            value={driver.driverType}
            onValueChange={(value) => update("driverType", value as Driver["driverType"])}
            options={toOptions(DRIVER_TYPE_OPTIONS)}
          />

          <FormDatePicker
            label="Date of Birth"
            id="driver-dob"
            error={errors.dateOfBirth}
            value={driver.dateOfBirth}
            onChange={(value) => update("dateOfBirth", value)}
          />

          <FormField
            label="Blood Group"
            htmlFor="driver-blood-group"
          >
            <Input
              id="driver-blood-group"
              placeholder="e.g. O+"
              value={driver.bloodGroup}
              onChange={(e) => update("bloodGroup", e.target.value)}
            />
          </FormField>

          <FormField
            label="Experience (Years)"
            htmlFor="driver-experience"
            error={errors.experienceYears}
          >
            <Input
              id="driver-experience"
              type="number"
              min={0}
              placeholder="0"
              value={driver.experienceYears}
              onChange={(e) => update("experienceYears", Number(e.target.value))}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Contact">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Mobile"
            htmlFor="driver-mobile"
            error={errors.mobile}
          >
            <Input
              id="driver-mobile"
              placeholder="Mobile Number"
              value={driver.mobile}
              onChange={(e) => update("mobile", e.target.value)}
            />
          </FormField>

          <FormField
            label="Alternate Mobile"
            htmlFor="driver-alternate-mobile"
            error={errors.alternateMobile}
          >
            <Input
              id="driver-alternate-mobile"
              placeholder="Alternate Mobile Number"
              value={driver.alternateMobile}
              onChange={(e) => update("alternateMobile", e.target.value)}
            />
          </FormField>

          <FormField
            label="Address"
            htmlFor="driver-address"
            className="sm:col-span-2"
          >
            <Textarea
              id="driver-address"
              placeholder="Address"
              value={driver.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </FormField>

          <FormField
            label="Emergency Contact Name"
            htmlFor="driver-emergency-name"
          >
            <Input
              id="driver-emergency-name"
              placeholder="Emergency Contact Name"
              value={driver.emergencyContactName}
              onChange={(e) => update("emergencyContactName", e.target.value)}
            />
          </FormField>

          <FormField
            label="Emergency Contact Number"
            htmlFor="driver-emergency-number"
            error={errors.emergencyContactNumber}
          >
            <Input
              id="driver-emergency-number"
              placeholder="Emergency Contact Number"
              value={driver.emergencyContactNumber}
              onChange={(e) => update("emergencyContactNumber", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="License & Compliance">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="License Number"
            htmlFor="driver-license-number"
            required
            error={errors.licenseNumber}
          >
            <Input
              id="driver-license-number"
              placeholder="License Number"
              value={driver.licenseNumber}
              onChange={(e) => update("licenseNumber", e.target.value.toUpperCase())}
            />
          </FormField>

          <FormSelect
            label="License Type"
            id="driver-license-type"
            required
            error={errors.licenseType}
            value={driver.licenseType}
            onValueChange={(value) => update("licenseType", value)}
            options={toOptions(LICENSE_TYPE_OPTIONS)}
          />

          <FormField
            label="License Issuing State"
            htmlFor="driver-license-state"
          >
            <Input
              id="driver-license-state"
              placeholder="License Issuing State"
              value={driver.licenseIssuingState}
              onChange={(e) => update("licenseIssuingState", e.target.value)}
            />
          </FormField>

          <FormDatePicker
            label="License Expiry"
            id="driver-license-expiry"
            error={errors.licenseExpiry}
            value={driver.licenseExpiry}
            onChange={(value) => update("licenseExpiry", value)}
          />
        </div>
      </FormSection>

      <FormSection title="Identity Documents">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Aadhaar Number"
            htmlFor="driver-aadhaar"
            error={errors.aadhaarNumber}
          >
            <Input
              id="driver-aadhaar"
              placeholder="Aadhaar Number"
              value={driver.aadhaarNumber}
              onChange={(e) => update("aadhaarNumber", e.target.value)}
            />
          </FormField>

          <FormField
            label="PAN"
            htmlFor="driver-pan"
            error={errors.pan}
          >
            <Input
              id="driver-pan"
              placeholder="PAN"
              value={driver.pan}
              onChange={(e) => update("pan", e.target.value.toUpperCase())}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Employment">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormDatePicker
            label="Date of Joining"
            id="driver-doj"
            error={errors.dateOfJoining}
            value={driver.dateOfJoining}
            onChange={(value) => update("dateOfJoining", value)}
          />

          <FormField
            label="Preferred Vehicle"
            htmlFor="driver-preferred-vehicle"
            hint="Optional — not linked to Vehicle Master yet."
          >
            <Input
              id="driver-preferred-vehicle"
              placeholder="e.g. MH12AB1234"
              value={driver.preferredVehicle}
              onChange={(e) => update("preferredVehicle", e.target.value.toUpperCase())}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Banking">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Bank Name"
            htmlFor="driver-bank-name"
          >
            <Input
              id="driver-bank-name"
              placeholder="Bank Name"
              value={driver.bankName}
              onChange={(e) => update("bankName", e.target.value)}
            />
          </FormField>

          <FormField
            label="Account Number"
            htmlFor="driver-account-number"
          >
            <Input
              id="driver-account-number"
              placeholder="Account Number"
              value={driver.accountNumber}
              onChange={(e) => update("accountNumber", e.target.value)}
            />
          </FormField>

          <FormField
            label="IFSC"
            htmlFor="driver-ifsc"
            error={errors.ifsc}
          >
            <Input
              id="driver-ifsc"
              placeholder="IFSC Code"
              value={driver.ifsc}
              onChange={(e) => update("ifsc", e.target.value.toUpperCase())}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Driver Photo">
        <FormField
          label="Photo"
          htmlFor="driver-photo"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
              {driver.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={driver.photoUrl}
                  alt="Driver"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="px-1 text-center text-[10px] text-muted-foreground">
                  No photo
                </span>
              )}
            </div>

            <div className="space-y-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingPhoto}
                onClick={() => document.getElementById("driver-photo")?.click()}
              >
                {uploadingPhoto ? "Uploading..." : driver.photoUrl ? "Replace" : "Upload"}
              </Button>

              <input
                id="driver-photo"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadPhoto(file);
                  e.target.value = "";
                }}
              />

              <p className="text-xs text-muted-foreground">PNG or JPG, up to 2MB.</p>
            </div>
          </div>
        </FormField>
      </FormSection>

      <FormSection title="Additional">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormSelect
            label="Status"
            id="driver-status"
            value={driver.status}
            onValueChange={(value) => update("status", value as Driver["status"])}
            options={toOptions(DRIVER_STATUS_OPTIONS)}
          />

          <FormField
            label="Remarks"
            htmlFor="driver-remarks"
            className="sm:col-span-2"
          >
            <Textarea
              id="driver-remarks"
              placeholder="Remarks"
              value={driver.remarks}
              onChange={(e) => update("remarks", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>
    </div>
  );
}
