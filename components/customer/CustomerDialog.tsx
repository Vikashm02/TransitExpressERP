"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import CustomerForm from "./CustomerForm";
import { validateCustomer, type Customer } from "./customer.schema";
import type { FieldErrors } from "@/lib/validation";
import type { CustomerRecord } from "@/components/services/customer.service";
import { pickFields } from "@/lib/utils";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerRecord | null;
  loading?: boolean;
  onSubmit: (values: Customer) => void | Promise<void>;
  /** Debounced draft save — must not finalize the record. */
  onAutosave?: (values: Customer) => void | Promise<void>;
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
  entryStatus: "final",
};

function toEditableCustomer(record: CustomerRecord): Customer {
  return pickFields(record, Object.keys(emptyCustomer) as (keyof Customer)[]);
}

export default function CustomerDialog({
  open,
  onOpenChange,
  customer,
  loading = false,
  onSubmit,
  onAutosave,
}: CustomerDialogProps) {
  const [values, setValues] = useState<Customer>(emptyCustomer);
  const [errors, setErrors] = useState<FieldErrors<Customer>>({});
  const [draftHint, setDraftHint] = useState<string | null>(null);

  const isEditing = Boolean(customer);

  useEffect(() => {
    if (open) {
      setValues(customer ? { ...emptyCustomer, ...toEditableCustomer(customer) } : emptyCustomer);
      setErrors({});
      setDraftHint(
        customer?.entryStatus === "draft" ? "Incomplete draft — continue editing, then Save." : null
      );
    }
  }, [open, customer]);

  useDebouncedAutosave({
    values,
    enabled: open && Boolean(onAutosave) && !loading && values.name.trim().length > 0,
    delayMs: 2000,
    onSave: async (next) => {
      if (!onAutosave) return;
      try {
        await onAutosave({ ...next, entryStatus: "draft" });
        setDraftHint("Draft saved");
      } catch {
        // Keep UI quiet — final Save still validates.
      }
    },
  });

  function handleSave() {
    const fieldErrors = validateCustomer(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit({ ...values, entryStatus: "final" });
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
          : "Enter the customer details below. Progress autosaves as an Incomplete draft."
      }
      loading={loading}
      loadingText="Saving customer..."
      footer={
        <>
          {draftHint ? (
            <p className="mr-auto text-xs text-muted-foreground">{draftHint}</p>
          ) : null}
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Customer"}
          </Button>
        </>
      }
    >
      <CustomerForm customer={values} errors={errors} onChange={setValues} />
    </FormDialog>
  );
}
