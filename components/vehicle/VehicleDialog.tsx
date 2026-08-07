"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import VehicleForm from "./VehicleForm";
import { Vehicle } from "./types";

interface VehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyVehicle: Vehicle = {
  vehicleNumber: "",
  vehicleType: "",
  ownerName: "",
  mobile: "",
  rcNumber: "",
  insuranceNumber: "",
  status: "Active",
};

export default function VehicleDialog({
  open,
  onOpenChange,
}: VehicleDialogProps) {
  const [vehicle, setVehicle] =
    useState<Vehicle>(emptyVehicle);

  function handleSave() {
    console.log(vehicle);

    onOpenChange(false);

    setVehicle(emptyVehicle);
  }

  function handleCancel() {
    onOpenChange(false);

    setVehicle(emptyVehicle);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Add Vehicle
          </DialogTitle>
        </DialogHeader>

        <VehicleForm
          vehicle={vehicle}
          onChange={setVehicle}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}