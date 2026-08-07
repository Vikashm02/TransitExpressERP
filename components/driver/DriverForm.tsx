"use client";

import { Driver } from "./types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DriverFormProps {
  driver: Driver;
  onChange: (driver: Driver) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function DriverForm({
  driver,
  onChange,
  onSave,
  onCancel,
}: DriverFormProps) {
  return (
    <div className="space-y-5">

      <Input
        placeholder="Driver Name"
        value={driver.driverName}
        onChange={(e) =>
          onChange({
            ...driver,
            driverName: e.target.value,
          })
        }
      />

      <Input
        placeholder="Mobile Number"
        value={driver.mobile}
        onChange={(e) =>
          onChange({
            ...driver,
            mobile: e.target.value,
          })
        }
      />

      <Input
        placeholder="License Number"
        value={driver.licenseNumber}
        onChange={(e) =>
          onChange({
            ...driver,
            licenseNumber: e.target.value,
          })
        }
      />

      <Input
        type="date"
        value={driver.licenseExpiry}
        onChange={(e) =>
          onChange({
            ...driver,
            licenseExpiry: e.target.value,
          })
        }
      />

      <Input
        placeholder="Address"
        value={driver.address}
        onChange={(e) =>
          onChange({
            ...driver,
            address: e.target.value,
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
          Save Driver
        </Button>

      </div>

    </div>
  );
}