"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import { CUSTOMER_STATUS_OPTIONS, type Customer } from "./customer.schema";
import type { FieldErrors } from "@/lib/validation";

interface CustomerFormProps {
  customer: Customer;
  errors?: FieldErrors<Customer>;
  onChange: (customer: Customer) => void;
}

export default function CustomerForm({
  customer,
  errors = {},
  onChange,
}: CustomerFormProps) {
  function update<K extends keyof Customer>(key: K, value: Customer[K]) {
    onChange({ ...customer, [key]: value });
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <FormField
        label="Customer Name"
        htmlFor="customer-name"
        required
        error={errors.name}
      >
        <Input
          id="customer-name"
          placeholder="Customer Name"
          value={customer.name}
          onChange={(e) => update("name", e.target.value)}
        />
      </FormField>

      <FormField
        label="GST Number"
        htmlFor="customer-gst"
        error={errors.gst}
      >
        <Input
          id="customer-gst"
          placeholder="GST Number"
          value={customer.gst}
          onChange={(e) => update("gst", e.target.value.toUpperCase())}
        />
      </FormField>

      <FormField
        label="Mobile Number"
        htmlFor="customer-mobile"
        error={errors.mobile}
      >
        <Input
          id="customer-mobile"
          placeholder="Mobile Number"
          value={customer.mobile}
          onChange={(e) => update("mobile", e.target.value)}
        />
      </FormField>

      <FormField
        label="Email"
        htmlFor="customer-email"
        error={errors.email}
      >
        <Input
          id="customer-email"
          type="email"
          placeholder="Email"
          value={customer.email}
          onChange={(e) => update("email", e.target.value)}
        />
      </FormField>

      <FormField
        label="City"
        htmlFor="customer-city"
        error={errors.city}
      >
        <Input
          id="customer-city"
          placeholder="City"
          value={customer.city}
          onChange={(e) => update("city", e.target.value)}
        />
      </FormField>

      <FormSelect
        label="Status"
        id="customer-status"
        value={customer.status}
        onValueChange={(value) => update("status", value as Customer["status"])}
        options={CUSTOMER_STATUS_OPTIONS.map((status) => ({
          label: status,
          value: status,
        }))}
      />

      <FormField
        label="Address"
        htmlFor="customer-address"
        error={errors.address}
        className="sm:col-span-2"
      >
        <Textarea
          id="customer-address"
          placeholder="Address"
          value={customer.address}
          onChange={(e) => update("address", e.target.value)}
        />
      </FormField>
    </div>
  );
}
