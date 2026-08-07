import { supabase } from "@/lib/supabase";
import type { Vehicle } from "@/components/vehicle/vehicle.schema";

/**
 * A persisted vehicle row. `gpsDeviceId` is reserved for future GPS
 * integration — it has no UI and is never written by this service, but is
 * surfaced here so reads stay forward-compatible once the column exists.
 */
export interface VehicleRecord extends Vehicle {
  id: number;
  gpsDeviceId?: string | null;
  created_at?: string;
}

const TABLE = "vehicles";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: Vehicle) {
  return {
    vehicle_number: values.vehicleNumber,
    rc_number: values.rcNumber,
    vehicle_type: values.vehicleType,
    owner_name: values.ownerName,
    owner_type: values.ownerType,
    mobile: values.mobile,

    capacity: values.capacity,
    capacity_unit: values.capacityUnit,

    hire_rate: values.hireRate,
    hire_type: values.hireType,

    chassis_number: values.chassisNumber,
    engine_number: values.engineNumber,

    insurance_number: values.insuranceNumber,
    insurance_expiry: emptyToNull(values.insuranceExpiry),
    permit_number: values.permitNumber,
    permit_expiry: emptyToNull(values.permitExpiry),
    fitness_number: values.fitnessNumber,
    fitness_expiry: emptyToNull(values.fitnessExpiry),
    puc_number: values.pucNumber,
    puc_expiry: emptyToNull(values.pucExpiry),

    remarks: values.remarks,

    status: values.status,
  };
}

/* ==========================================================
   GET ALL VEHICLES
========================================================== */

export async function getVehicles(): Promise<VehicleRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as VehicleRecord[];
}

/* ==========================================================
   GET ONE VEHICLE
========================================================== */

export async function getVehicle(id: number): Promise<VehicleRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data as VehicleRecord;
}

/* ==========================================================
   CREATE VEHICLE
========================================================== */

export async function createVehicle(values: Vehicle): Promise<VehicleRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) throw error;

  return data as VehicleRecord;
}

/* ==========================================================
   UPDATE VEHICLE
========================================================== */

export async function updateVehicle(
  id: number,
  values: Vehicle
): Promise<VehicleRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(values))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data as VehicleRecord;
}

/* ==========================================================
   DELETE VEHICLE
========================================================== */

export async function deleteVehicle(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
