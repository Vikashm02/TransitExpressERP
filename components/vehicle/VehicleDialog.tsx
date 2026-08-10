"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import VehicleForm from "./VehicleForm";
import { validateVehicle, type Vehicle } from "./vehicle.schema";
import type { FieldErrors } from "@/lib/validation";
import type { VehicleRecord } from "@/components/services/vehicle.service";
import { pickFields } from "@/lib/utils";

interface VehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new vehicle. */
  vehicle?: VehicleRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: Vehicle) => void | Promise<void>;
}

const emptyVehicle: Vehicle = {
  vehicleNumber: "",
  rcNumber: "",
  vehicleType: "",
  ownerName: "",
  ownerType: "Market",
  mobile: "",

  capacity: 0,
  capacityUnit: "TON",

  hireRate: 0,
  hireType: "Fixed",

  chassisNumber: "",
  engineNumber: "",

  insuranceNumber: "",
  insuranceExpiry: "",
  permitNumber: "",
  permitExpiry: "",
  fitnessNumber: "",
  fitnessExpiry: "",
  pucNumber: "",
  pucExpiry: "",

  remarks: "",

  status: "Active",
};

/** Picks only the `Vehicle` schema fields off a `VehicleRecord`, dropping
 * server-owned columns (`id`, `created_at`, `gpsDeviceId`) so they never
 * enter editable form state — and therefore never reach `updateVehicle()`'s
 * payload. */
function toEditableVehicle(record: VehicleRecord): Vehicle {
  return pickFields(record, Object.keys(emptyVehicle) as (keyof Vehicle)[]);
}

export default function VehicleDialog({
  open,
  onOpenChange,
  vehicle,
  loading = false,
  onSubmit,
}: VehicleDialogProps) {
  const [values, setValues] = useState<Vehicle>(emptyVehicle);
  const [errors, setErrors] = useState<FieldErrors<Vehicle>>({});

  const isEditing = Boolean(vehicle);

  useEffect(() => {
    if (open) {
      setValues(vehicle ? { ...emptyVehicle, ...toEditableVehicle(vehicle) } : emptyVehicle);
      setErrors({});
    }
  }, [open, vehicle]);

  function handleSave() {
    const fieldErrors = validateVehicle(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(values);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Vehicle" : "Add Vehicle"}
      description={
        isEditing
          ? "Update the vehicle details below."
          : "Enter the vehicle details below."
      }
      size="xl"
      loading={loading}
      loadingText="Saving vehicle..."
      footer={
        <>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Vehicle"}
          </Button>
        </>
      }
    >
      <VehicleForm
        vehicle={values}
        errors={errors}
        onChange={setValues}
      />
    </FormDialog>
  );
}
