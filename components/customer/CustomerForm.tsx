"use client";

import { Customer } from "./types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CustomerFormProps {
  customer: Customer;
  onChange: (customer: Customer) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function CustomerForm({
  customer,
  onChange,
  onSave,
  onCancel,
}: CustomerFormProps) {
  return (
    <div className="space-y-5">

      <Input
        placeholder="Customer Name"
        value={customer.name}
        onChange={(e) =>
          onChange({ ...customer, name: e.target.value })
        }
      />

      <Input
        placeholder="GST Number"
        value={customer.gst}
        onChange={(e) =>
          onChange({ ...customer, gst: e.target.value })
        }
      />

      <Input
        placeholder="Mobile Number"
        value={customer.mobile}
        onChange={(e) =>
          onChange({ ...customer, mobile: e.target.value })
        }
      />

      <Input
        placeholder="Email"
        value={customer.email}
        onChange={(e) =>
          onChange({ ...customer, email: e.target.value })
        }
      />

      <Input
        placeholder="City"
        value={customer.city}
        onChange={(e) =>
          onChange({ ...customer, city: e.target.value })
        }
      />

      <Input
        placeholder="Address"
        value={customer.address}
        onChange={(e) =>
          onChange({ ...customer, address: e.target.value })
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
          Save Customer
        </Button>

      </div>

    </div>
  );
}