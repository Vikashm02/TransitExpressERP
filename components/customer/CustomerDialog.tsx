"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import CustomerForm from "./CustomerForm";
import { Customer } from "./types";

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}: CustomerDialogProps) {
  const [customer, setCustomer] =
    useState<Customer>(emptyCustomer);

  function handleSave() {
    console.log(customer);

    onOpenChange(false);

    setCustomer(emptyCustomer);
  }

  function handleCancel() {
    onOpenChange(false);

    setCustomer(emptyCustomer);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Add Customer
          </DialogTitle>
        </DialogHeader>

        <CustomerForm
          customer={customer}
          onChange={setCustomer}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}