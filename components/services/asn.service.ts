import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { Asn } from "@/components/asn/asn.schema";
import { calcSupplierGrossWeight } from "@/components/asn/asn.schema";
import type { LRRecord } from "@/components/services/lr.service";

export interface AsnRecord extends Asn {
  id: number;
  createdBy: string | null;
  updatedBy: string | null;
  created_at?: string;
  updated_at?: string;
}

const TABLE = "asn_creations";
const ASSETS_BUCKET = "asn-assets";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: Asn) {
  const row = objectToSnakeCase({
    ...values,
    supplierGrossWeight: calcSupplierGrossWeight(
      values.supplierTareWeight,
      values.supplierNetWeight
    ),
  });
  row.lr_date = emptyToNull(values.lrDate);
  row.challan_invoice_date = emptyToNull(values.challanInvoiceDate);
  row.weightment_slip_url = emptyToNull(values.weightmentSlipUrl);
  row.challan_copy_slip_url = emptyToNull(values.challanCopySlipUrl);
  row.lr_copy_slip_url = emptyToNull(values.lrCopySlipUrl);
  return row;
}

function fromRow(row: Record<string, unknown>): AsnRecord {
  const { id, created_at, updated_at, created_by, updated_by, ...rest } = row;
  const asn = objectToCamelCase<Asn>(rest);

  return {
    ...asn,
    asnNumber: asn.asnNumber || "",
    asnDate: asn.asnDate || "",
    lrNumber: asn.lrNumber || "",
    lrDate: asn.lrDate || "",
    vehicleNumber: asn.vehicleNumber || "",
    driverName: asn.driverName || "",
    driverContact: asn.driverContact || "",
    challanInvoiceNumber: asn.challanInvoiceNumber || "",
    challanInvoiceDate: asn.challanInvoiceDate || "",
    supplierTareWeight: Number(asn.supplierTareWeight) || 0,
    supplierNetWeight: Number(asn.supplierNetWeight) || 0,
    supplierGrossWeight: Number(asn.supplierGrossWeight) || 0,
    challanQty: Number(asn.challanQty) || 0,
    expectedTimeOfArrival: asn.expectedTimeOfArrival || "",
    roadPermit: asn.roadPermit || "",
    weightmentSlipUrl: asn.weightmentSlipUrl || "",
    challanCopySlipUrl: asn.challanCopySlipUrl || "",
    lrCopySlipUrl: asn.lrCopySlipUrl || "",
    id: id as number,
    createdBy: (created_by as string | null) ?? null,
    updatedBy: (updated_by as string | null) ?? null,
    created_at: created_at as string | undefined,
    updated_at: updated_at as string | undefined,
  };
}

/** Sequential unique ASN number: ASN0001, ASN0002, … */
async function generateAsnNumber(): Promise<string> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `ASN${String(next).padStart(4, "0")}`;
}

/**
 * DC/Challan number preferred; otherwise invoice number.
 * Matching dates follow the same preference.
 */
export function pickChallanOrInvoice(lr: LRRecord): {
  number: string;
  date: string;
} {
  const dc = (lr.dcNumber || "").trim();
  if (dc) {
    return { number: dc, date: (lr.dcDate || "").trim() };
  }
  const inv = (lr.invoiceNumber || "").trim();
  if (inv) {
    return { number: inv, date: (lr.invoiceDate || "").trim() };
  }
  return { number: "", date: "" };
}

export function applyLrToAsn(current: Asn, lr: LRRecord): Asn {
  const doc = pickChallanOrInvoice(lr);
  const net = Number(lr.loadingWeight) || 0;
  const tare = Number(current.supplierTareWeight) || 0;

  return {
    ...current,
    lrNumber: lr.lrNumber,
    lrDate: lr.lrDate || "",
    vehicleNumber: lr.vehicleNumber || "",
    driverName: lr.driverName || "",
    driverContact: lr.driverMobile || "",
    challanInvoiceNumber: doc.number,
    challanInvoiceDate: doc.date,
    supplierNetWeight: net,
    challanQty: net,
    supplierGrossWeight: calcSupplierGrossWeight(tare, net),
  };
}

/* ==========================================================
   GET ALL
========================================================== */

export async function getAsns(): Promise<AsnRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE
========================================================== */

export async function getAsn(id: number): Promise<AsnRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE
========================================================== */

export async function createAsn(values: Asn): Promise<AsnRecord> {
  let createdBy: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    createdBy = data.user?.id ?? null;
  } catch {
    createdBy = null;
  }

  const asnNumber = values.asnNumber.trim() || (await generateAsnNumber());

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ...toRow({ ...values, asnNumber }),
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE
========================================================== */

export async function updateAsn(
  id: number,
  values: Asn
): Promise<AsnRecord> {
  const sanitized = omitServerFields(
    values as unknown as Record<string, unknown>
  ) as Asn;

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
   DELETE — DB row + this ASN's asn-assets objects only
========================================================== */

/**
 * Extract the object path inside `asn-assets` from a public storage URL.
 * Returns null for empty / non-matching URLs so we never touch other buckets.
 */
function asnAssetPathFromPublicUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const marker = `/storage/v1/object/public/${ASSETS_BUCKET}/`;
  const idx = trimmed.indexOf(marker);
  if (idx === -1) return null;

  const raw = trimmed.slice(idx + marker.length).split("?")[0] ?? "";
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }

  if (!path || path.includes("..") || path.startsWith("/")) return null;
  return path;
}

/**
 * Safe delete order:
 * 1) Remove this ASN's attachment objects from `asn-assets` (if any).
 * 2) Only then delete the `asn_creations` row.
 * Storage failure aborts before the row is removed; DB failure is reported
 * (attachments may already be gone).
 */
export async function deleteAsn(id: number): Promise<void> {
  const asn = await getAsn(id);

  const paths = [
    asn.weightmentSlipUrl,
    asn.challanCopySlipUrl,
    asn.lrCopySlipUrl,
  ]
    .map(asnAssetPathFromPublicUrl)
    .filter((path): path is string => Boolean(path));

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(ASSETS_BUCKET)
      .remove(paths);

    if (storageError) throw storageError;
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}

/* ==========================================================
   FILE UPLOADS — three separate slip kinds
========================================================== */

export type AsnSlipKind = "weightment" | "challan-copy" | "lr-copy";

export async function uploadAsnSlip(
  file: File,
  kind: AsnSlipKind
): Promise<string> {
  const extension = file.name.split(".").pop() ?? "pdf";
  const path = `${kind}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
