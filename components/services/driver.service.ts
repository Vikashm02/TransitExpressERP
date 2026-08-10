import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields, toSnakeCase } from "@/lib/caseMapping";
import type { Driver } from "@/components/driver/driver.schema";

export interface DriverRecord extends Driver {
  id: number;
  created_at?: string;
}

const TABLE = "drivers";
const ASSETS_BUCKET = "driver-assets";

/** Date columns are nullable in the database; the app's `Driver` type
 * models them as plain (possibly empty) strings. */
const DATE_FIELDS = ["dateOfBirth", "licenseExpiry", "dateOfJoining"] as const;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: Driver) {
  const row = objectToSnakeCase(values);

  for (const field of DATE_FIELDS) {
    row[toSnakeCase(field)] = emptyToNull(values[field]);
  }

  // `photoUrl` is only ever set via `uploadDriverAsset`; still normalize
  // an empty string to `null` for the nullable Storage-URL column.
  row.photo_url = emptyToNull(values.photoUrl);

  return row;
}

/** Supabase returns raw snake_case columns; `id`/`created_at` pass through
 * explicitly since they live outside the `Driver` domain type. */
function fromRow(row: Record<string, unknown>): DriverRecord {
  const { id, created_at, ...rest } = row;

  const driver = objectToCamelCase<Driver>(rest);

  for (const field of DATE_FIELDS) {
    if (driver[field] == null) {
      (driver as Record<string, unknown>)[field] = "";
    }
  }

  if ((driver as Record<string, unknown>).photoUrl == null) {
    (driver as Record<string, unknown>).photoUrl = "";
  }

  return {
    ...driver,
    id: id as number,
    created_at: created_at as string | undefined,
  };
}

/* ==========================================================
   GET ALL DRIVERS
========================================================== */

export async function getDrivers(): Promise<DriverRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE DRIVER
========================================================== */

export async function getDriver(id: number): Promise<DriverRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE DRIVER
========================================================== */

export async function createDriver(values: Driver): Promise<DriverRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE DRIVER
========================================================== */

export async function updateDriver(
  id: number,
  values: Driver
): Promise<DriverRecord> {
  // `id`/`created_at` are server-owned and must never reach the update
  // payload. (The edit dialog seeds its state from the full DB record, so
  // the caller can't be trusted to have already excluded them.)
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as Driver;

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
   DELETE DRIVER
========================================================== */

export async function deleteDriver(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}

/* ==========================================================
   PHOTO UPLOAD
   Requires a public "driver-assets" Storage bucket to exist.
========================================================== */

export async function uploadDriverAsset(file: File): Promise<string> {
  const extension = file.name.split(".").pop() ?? "png";
  const path = `photo/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);

  return data.publicUrl;
}
