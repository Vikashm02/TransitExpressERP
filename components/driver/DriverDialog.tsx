"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import DriverForm from "./DriverForm";
import { validateDriver, type Driver } from "./driver.schema";
import type { FieldErrors } from "@/lib/validation";
import {
  uploadDriverAsset,
  type DriverRecord,
} from "@/components/services/driver.service";

interface DriverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new driver. */
  driver?: DriverRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: Driver) => void | Promise<void>;
}

const emptyDriver: Driver = {
  driverName: "",
  driverType: "Own",
  dateOfBirth: "",
  bloodGroup: "",
  experienceYears: 0,

  mobile: "",
  alternateMobile: "",
  address: "",
  emergencyContactName: "",
  emergencyContactNumber: "",

  licenseNumber: "",
  licenseType: "LMV",
  licenseIssuingState: "",
  licenseExpiry: "",

  aadhaarNumber: "",
  pan: "",

  dateOfJoining: "",
  preferredVehicle: "",

  bankName: "",
  accountNumber: "",
  ifsc: "",

  photoUrl: "",

  remarks: "",
  status: "Active",
};

export default function DriverDialog({
  open,
  onOpenChange,
  driver,
  loading = false,
  onSubmit,
}: DriverDialogProps) {
  const [values, setValues] = useState<Driver>(emptyDriver);
  const [errors, setErrors] = useState<FieldErrors<Driver>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const isEditing = Boolean(driver);

  useEffect(() => {
    if (open) {
      setValues(driver ? { ...emptyDriver, ...driver } : emptyDriver);
      setErrors({});
    }
  }, [open, driver]);

  async function handleUploadPhoto(file: File) {
    try {
      setUploadingPhoto(true);
      const url = await uploadDriverAsset(file);
      setValues((prev) => ({ ...prev, photoUrl: url }));
      toast.success("Photo uploaded successfully.");
    } catch (error) {
      console.error(error);
      toast.error('Unable to upload photo. Confirm the "driver-assets" storage bucket exists.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  function handleSave() {
    const fieldErrors = validateDriver(values);

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
      title={isEditing ? "Edit Driver" : "Add Driver"}
      description={
        isEditing
          ? "Update the driver details below."
          : "Enter the driver details below."
      }
      size="xl"
      loading={loading}
      loadingText="Saving driver..."
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
            {loading ? "Saving..." : "Save Driver"}
          </Button>
        </>
      }
    >
      <DriverForm
        driver={values}
        errors={errors}
        onChange={setValues}
        onUploadPhoto={handleUploadPhoto}
        uploadingPhoto={uploadingPhoto}
      />
    </FormDialog>
  );
}
