import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields, toSnakeCase } from "@/lib/caseMapping";
import type { Vehicle } from "@/components/vehicle/vehicle.schema";
import {
  canonicalizeVehicleNumber,
  normalizeVehicleNumberKey,
} from "@/lib/vehicleNumber";

/** A persisted vehicle row. `gpsDeviceId` is reserved for future GPS
 * integration — it has no UI and is never written by this service, but is
 * surfaced here so reads stay forward-compatible once the column exists. */
export interface VehicleRecord extends Vehicle {
  id: number;
  gpsDeviceId?: string | null;
  created_at?: string;
}

/** Fields copied from a finalized LR into Vehicle Master (current state only). */
export interface LrVehicleMasterSyncInput {
  vehicleNumber: string;
  vehicleType: string;
  transporter: string;
  driverName: string;
  driverMobile: string;
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

const LR_SYNC_TEXT_FIELDS = [
  "transporter",
  "driverName",
  "driverMobile",
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

  for (const field of LR_SYNC_TEXT_FIELDS) {
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

function canonicalVehicleNumber(raw: string): string {
  const trimmed = raw.trim();
  return canonicalizeVehicleNumber(trimmed) || trimmed.toUpperCase();
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

/**
 * Restricted Vehicle lookup for LR Create/Edit only.
 * Uses get_lr_vehicle_lookup (migration 054) — requires lr create/edit,
 * NOT vehicle:view. Does not replace getVehicles() / Master.
 */
export type LrVehicleLookupRow = Pick<
  VehicleRecord,
  | "id"
  | "vehicleNumber"
  | "vehicleType"
  | "transporter"
  | "driverName"
  | "driverMobile"
  | "hireRate"
  | "hireType"
  | "ownerName"
  | "ownerType"
  | "mobile"
>;

export async function getLrVehicleLookup(): Promise<LrVehicleLookupRow[]> {
  const { data, error } = await supabase.rpc("get_lr_vehicle_lookup");

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: Number(row.id),
      vehicleNumber: String(row.vehicle_number ?? ""),
      vehicleType: String(row.vehicle_type ?? ""),
      transporter: String(row.transporter ?? ""),
      driverName: String(row.driver_name ?? ""),
      driverMobile: String(row.driver_mobile ?? ""),
      hireRate: Number(row.hire_rate ?? 0),
      hireType: (row.hire_type === "Per Ton" ? "Per Ton" : "Fixed") as VehicleRecord["hireType"],
      ownerName: String(row.owner_name ?? ""),
      ownerType: String(row.owner_type ?? "") as VehicleRecord["ownerType"],
      mobile: String(row.mobile ?? ""),
    };
  });
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

/**
 * Find a Vehicle Master row by vehicle number using the app's
 * alphanumeric key (hyphen/format differences ignored).
 */
export async function findVehicleByNumber(
  vehicleNumber: string
): Promise<VehicleRecord | null> {
  const want = normalizeVehicleNumberKey(vehicleNumber);
  if (!want) return null;

  const vehicles = await getVehicles();
  return (
    vehicles.find(
      (vehicle) => normalizeVehicleNumberKey(vehicle.vehicleNumber) === want
    ) ?? null
  );
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
  // `id`/`created_at` are server-owned and must never reach the update
  // payload. (The edit dialog seeds its state from the full DB record, so
  // the caller can't be trusted to have already excluded them.)
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as Vehicle;

  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(sanitized))
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

/**
 * After a successful LR save: upsert Vehicle Master current fields from
 * the LR vehicle details. Does not rewrite historical LRs.
 *
 * Updates only: vehicle_type, transporter, driver_name, driver_mobile.
 * Never touches owner_name / compliance / hire on update.
 *
 * Called only from LR finalize flows (not draft autosave).
 * Relies on existing authenticated session; vehicles currently have no RLS.
 * Intended for users who already passed LR save authorization.
 */
export async function syncVehicleMasterFromLr(
  input: LrVehicleMasterSyncInput
): Promise<VehicleRecord> {
  const vehicleNumber = canonicalVehicleNumber(input.vehicleNumber);
  if (!vehicleNumber) {
    throw new Error("Vehicle number is required to sync Vehicle Master.");
  }

  const vehicleType = input.vehicleType.trim();
  const transporter = input.transporter.trim();
  const driverName = input.driverName.trim();
  const driverMobile = input.driverMobile.trim();

  const existing = await findVehicleByNumber(vehicleNumber);

  if (existing) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        vehicle_type: vehicleType || existing.vehicleType,
        transporter,
        driver_name: driverName,
        driver_mobile: driverMobile,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return fromRow(data);
  }

  const insertPayload: Vehicle = {
    vehicleNumber,
    rcNumber: "",
    vehicleType: vehicleType || "Truck",
    ownerName: "",
    ownerType: "Market",
    mobile: "",
    transporter,
    driverName,
    driverMobile,
    capacity: 0,
    capacityUnit: "TON",
    hireRate: 0,
    hireType: "Fixed",
    chassisNumber: "",
    engineNumber: "",
    insuranceNumber: "",
    insuranceExpiry: "",
    permitNumber: "",
    permitExpiry: "",
    fitnessNumber: "",
    fitnessExpiry: "",
    pucNumber: "",
    pucExpiry: "",
    remarks: "",
    status: "Active",
  };

  try {
    return await createVehicle(insertPayload);
  } catch (error) {
    // Concurrent create: unique(vehicle_number) — retry as update.
    const raced = await findVehicleByNumber(vehicleNumber);
    if (!raced) throw error;

    const { data, error: updateError } = await supabase
      .from(TABLE)
      .update({
        vehicle_type: vehicleType || raced.vehicleType,
        transporter,
        driver_name: driverName,
        driver_mobile: driverMobile,
      })
      .eq("id", raced.id)
      .select("*")
      .single();

    if (updateError) throw updateError;
    return fromRow(data);
  }
}

/**
 * After a successful Financials save: set Vehicle Master owner_name from
 * broker_name when broker is non-empty. Never clears owner with blank.
 */
export async function syncVehicleOwnerFromBroker(input: {
  vehicleNumber: string;
  brokerName: string;
}): Promise<VehicleRecord | null> {
  const brokerName = input.brokerName.trim();
  if (!brokerName) return null;

  const vehicleNumber = canonicalVehicleNumber(input.vehicleNumber);
  if (!vehicleNumber) return null;

  const existing = await findVehicleByNumber(vehicleNumber);

  if (existing) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ owner_name: brokerName })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return fromRow(data);
  }

  // Vehicle not in master yet — create a minimal Active row so broker is not lost.
  return createVehicle({
    vehicleNumber,
    rcNumber: "",
    vehicleType: "Truck",
    ownerName: brokerName,
    ownerType: "Market",
    mobile: "",
    transporter: "",
    driverName: "",
    driverMobile: "",
    capacity: 0,
    capacityUnit: "TON",
    hireRate: 0,
    hireType: "Fixed",
    chassisNumber: "",
    engineNumber: "",
    insuranceNumber: "",
    insuranceExpiry: "",
    permitNumber: "",
    permitExpiry: "",
    fitnessNumber: "",
    fitnessExpiry: "",
    pucNumber: "",
    pucExpiry: "",
    remarks: "",
    status: "Active",
  });
}
