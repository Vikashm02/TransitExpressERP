import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase } from "@/lib/caseMapping";
import type { Company } from "@/components/company/company.schema";

export interface CompanyRecord extends Company {
  id: number;
  created_at?: string;
  updated_at?: string;
}

const TABLE = "company_settings";
const ASSETS_BUCKET = "company-assets";

/** Optional URL fields are stored as `null` rather than an empty string. */
const NULLABLE_URL_FIELDS = ["logoUrl", "signatureUrl", "stampUrl", "digitalSignatureUrl"] as const;

/** Falls back to a sensible default if the column hasn't been set yet. */
const NUMERIC_DEFAULTS: Partial<Record<keyof Company, number>> = {
  lrPrefixLength: 4,
  invoicePrefixLength: 4,
  voucherPrefixLength: 4,
  lrRunningNumber: 0,
  invoiceRunningNumber: 0,
  defaultGstPercentage: 0,
};

function toRow(values: Company) {
  const row = objectToSnakeCase(values);

  for (const field of NULLABLE_URL_FIELDS) {
    const value = values[field];
    const column =
      field === "logoUrl"
        ? "logo_url"
        : field === "signatureUrl"
          ? "signature_url"
          : field === "stampUrl"
            ? "stamp_url"
            : "digital_signature_url";
    row[column] = value.trim() === "" ? null : value;
  }

  return row;
}

/** Supabase returns raw snake_case columns; `id`/`created_at`/`updated_at`
 * pass through explicitly since they live outside the `Company` domain type. */
function fromRow(row: Record<string, unknown>): CompanyRecord {
  const { id, created_at, updated_at, ...rest } = row;

  const company = objectToCamelCase<Record<string, unknown>>(rest);

  for (const field of NULLABLE_URL_FIELDS) {
    if (company[field] == null) company[field] = "";
  }

  for (const [field, fallback] of Object.entries(NUMERIC_DEFAULTS)) {
    if (company[field] == null || company[field] === "") company[field] = fallback;
  }

  return {
    ...(company as Company),
    id: id as number,
    created_at: created_at as string | undefined,
    updated_at: updated_at as string | undefined,
  };
}

/* ==========================================================
   GET COMPANY (singleton — returns null if not yet configured)
========================================================== */

export async function getCompany(): Promise<CompanyRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return fromRow(data);
}

/**
 * Atomically reserves the next LR document number from company_settings
 * (migration 036). Uses SELECT … FOR UPDATE inside the RPC so concurrent
 * creators never receive the same number.
 *
 * Call via create_numbered_lr_draft on first meaningful draft, or directly
 * on final create / legacy DRAFT-* finalize. Never on dialog open, empty
 * cancel, or historical LR Entry bulk upload (file supplies the number).
 */
export async function allocateNextLrNumber(): Promise<string> {
  const { data, error } = await supabase.rpc("allocate_next_lr_number");
  if (error) throw error;
  if (!data || typeof data !== "string") {
    throw new Error("Unable to allocate the next LR number.");
  }
  return data;
}

/* ==========================================================
   SAVE COMPANY (upsert — no delete, this is a singleton)
========================================================== */

export async function saveCompany(
  values: Company,
  existingId?: number
): Promise<CompanyRecord> {
  const row = toRow(values);

  const query = existingId
    ? supabase.from(TABLE).update(row).eq("id", existingId)
    : supabase.from(TABLE).insert(row);

  const { data, error } = await query.select().single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   ASSET UPLOAD (Logo / Signature / Stamp / Digital Signature)
   Requires a public "company-assets" Storage bucket to exist.
   "digital-signature" is a separate kind/path from "signature" — the
   existing Authorized Signature image upload is untouched.
========================================================== */

export async function uploadCompanyAsset(
  file: File,
  kind: "logo" | "signature" | "stamp" | "digital-signature"
): Promise<string> {
  const extension = file.name.split(".").pop() ?? "png";
  const path = `${kind}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);

  return data.publicUrl;
}
