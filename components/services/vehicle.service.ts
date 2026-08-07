import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, toSnakeCase } from "@/lib/caseMapping";
import type { Vehicle } from "@/components/vehicle/vehicle.schema";

/** A persisted vehicle row. `gpsDeviceId` is reserved for future GPS
 * integration — it has no UI and is never written by this service, but is
 * surfaced here so reads stay forward-compatible once the column exists. */
export interface VehicleRecord extends Vehicle {
  id: number;
  gpsDeviceId?: string | null;
  created_at?: string;
}

const TABLE = "vehicles";

/** Compliance expiry columns are nullable in the database; the app's `Vehicle`
 * type models them as plain (possibly empty) strings. */
const EXPIRY_FIELDS = [
  "insuranceExpiry",
  "permitExpiry",
  "fitnessExpiry",
  "pucExpiry",
] as const;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: Vehicle) {
  const row = objectToSnakeCase(values);

  for (const field of EXPIRY_FIELDS) {
    row[toSnakeCase(field)] = emptyToNull(values[field]);
  }

  return row;
}

/** Supabase returns raw snake_case columns; `id`/`created_at`/`gps_device_id`
 * pass through explicitly since they live outside the `Vehicle` domain type. */
function fromRow(row: Record<string, unknown>): VehicleRecord {
  const { id, created_at, gps_device_id, ...rest } = row;

  const vehicle = objectToCamelCase<Vehicle>(rest);

  for (const field of EXPIRY_FIELDS) {
    if (vehicle[field] == null) {
      (vehicle as Record<string, unknown>)[field] = "";
    }
  }

  return {
    ...vehicle,
    id: id as number,
    created_at: created_at as string | undefined,
    gpsDeviceId: gps_device_id as string | null | undefined,
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

  return (data ?? []).map(fromRow);
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

  return fromRow(data);
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

  return fromRow(data);
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

  return fromRow(data);
}

/* ==========================================================
   DELETE VEHICLE
========================================================== */

export async function deleteVehicle(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
