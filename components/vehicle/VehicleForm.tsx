"use client";

import { Vehicle } from "./types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface VehicleFormProps {
  vehicle: Vehicle;
  onChange: (vehicle: Vehicle) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function VehicleForm({
  vehicle,
  onChange,
  onSave,
  onCancel,
}: VehicleFormProps) {
  return (
    <div className="space-y-5">

      <Input
        placeholder="Vehicle Number"
        value={vehicle.vehicleNumber}
        onChange={(e) =>
          onChange({
            ...vehicle,
            vehicleNumber: e.target.value,
          })
        }
      />

      <Input
        placeholder="Vehicle Type"
        value={vehicle.vehicleType}
        onChange={(e) =>
          onChange({
            ...vehicle,
            vehicleType: e.target.value,
          })
        }
      />

      <Input
        placeholder="Owner Name"
        value={vehicle.ownerName}
        onChange={(e) =>
          onChange({
            ...vehicle,
            ownerName: e.target.value,
          })
        }
      />

      <Input
        placeholder="Mobile Number"
        value={vehicle.mobile}
        onChange={(e) =>
          onChange({
            ...vehicle,
            mobile: e.target.value,
          })
        }
      />

      <Input
        placeholder="RC Number"
        value={vehicle.rcNumber}
        onChange={(e) =>
          onChange({
            ...vehicle,
            rcNumber: e.target.value,
          })
        }
      />

      <Input
        placeholder="Insurance Number"
        value={vehicle.insuranceNumber}
        onChange={(e) =>
          onChange({
            ...vehicle,
            insuranceNumber: e.target.value,
          })
        }
      />

      <div className="flex justify-end gap-3 pt-4">

        <Button
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button
          onClick={onSave}
        >
          Save Vehicle
        </Button>

      </div>

    </div>
  );
}