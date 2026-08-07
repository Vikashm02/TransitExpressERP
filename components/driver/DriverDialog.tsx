"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import DriverForm from "./DriverForm";
import { Driver } from "./types";

interface DriverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyDriver: Driver = {
  driverName: "",
  mobile: "",
  licenseNumber: "",
  licenseExpiry: "",
  address: "",
  status: "Active",
};

export default function DriverDialog({
  open,
  onOpenChange,
}: DriverDialogProps) {
  const [driver, setDriver] =
    useState<Driver>(emptyDriver);

  function handleSave() {
    console.log(driver);

    onOpenChange(false);

    setDriver(emptyDriver);
  }

  function handleCancel() {
    onOpenChange(false);

    setDriver(emptyDriver);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Add Driver
          </DialogTitle>
        </DialogHeader>

        <DriverForm
          driver={driver}
          onChange={setDriver}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}