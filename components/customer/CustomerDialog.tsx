"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import CustomerForm from "./CustomerForm";
import { validateCustomer, type Customer } from "./customer.schema";
import type { FieldErrors } from "@/lib/validation";
import type { CustomerRecord } from "@/components/services/customer.service";

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new customer. */
  customer?: CustomerRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: Customer) => void | Promise<void>;
}

const emptyCustomer: Customer = {
  code: "",
  name: "",
  gst: "",
  mobile: "",
  email: "",
  city: "",
  address: "",
  status: "Active",
};

export default function CustomerDialog({
  open,
  onOpenChange,
  customer,
  loading = false,
  onSubmit,
}: CustomerDialogProps) {
  const [values, setValues] = useState<Customer>(emptyCustomer);
  const [errors, setErrors] = useState<FieldErrors<Customer>>({});

  const isEditing = Boolean(customer);

  useEffect(() => {
    if (open) {
      setValues(customer ? { ...emptyCustomer, ...customer } : emptyCustomer);
      setErrors({});
    }
  }, [open, customer]);

  function handleSave() {
    const fieldErrors = validateCustomer(values);

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
      title={isEditing ? "Edit Customer" : "Add Customer"}
      description={
        isEditing
          ? "Update the customer details below."
          : "Enter the customer details below."
      }
      loading={loading}
      loadingText="Saving customer..."
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
            {loading ? "Saving..." : "Save Customer"}
          </Button>
        </>
      }
    >
      <CustomerForm
        customer={values}
        errors={errors}
        onChange={setValues}
      />
    </FormDialog>
  );
}
