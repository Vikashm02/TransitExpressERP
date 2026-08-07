import { supabase } from "@/lib/supabase";
import type { Company } from "@/components/company/company.schema";

export interface CompanyRecord extends Company {
  id: number;
  created_at?: string;
  updated_at?: string;
}

const TABLE = "company_settings";
const ASSETS_BUCKET = "company-assets";

function toRow(values: Company) {
  return {
    company_name: values.companyName,
    company_short_name: values.companyShortName,
    gstin: values.gstin,
    pan: values.pan,
    cin: values.cin,

    contact_person: values.contactPerson,
    mobile: values.mobile,
    alternate_mobile: values.alternateMobile,
    email: values.email,
    website: values.website,

    address: values.address,
    city: values.city,
    state: values.state,
    pincode: values.pincode,

    account_holder_name: values.accountHolderName,
    bank_name: values.bankName,
    bank_branch: values.bankBranch,
    account_number: values.accountNumber,
    ifsc: values.ifsc,
    upi_id: values.upiId,

    logo_url: values.logoUrl || null,
    signature_url: values.signatureUrl || null,
    stamp_url: values.stampUrl || null,

    financial_year: values.financialYear,
    lr_prefix: values.lrPrefix,
    invoice_prefix: values.invoicePrefix,
    voucher_prefix: values.voucherPrefix,
    lr_prefix_length: values.lrPrefixLength,
    invoice_prefix_length: values.invoicePrefixLength,
    voucher_prefix_length: values.voucherPrefixLength,

    default_branch: values.defaultBranch,
    default_currency: values.defaultCurrency,
    default_freight_type: values.defaultFreightType,
    default_gst_percentage: values.defaultGstPercentage,
  };
}

/**
 * Supabase returns raw snake_case column names — this maps them back onto
 * the camelCase `Company` shape the app works with everywhere else.
 */
function fromRow(row: Record<string, unknown>): CompanyRecord {
  const asString = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
  const asNumber = (value: unknown, fallback = 0) =>
    typeof value === "number" ? value : value == null || value === "" ? fallback : Number(value);

  return {
    id: Number(row.id),

    companyName: asString(row.company_name),
    companyShortName: asString(row.company_short_name),
    gstin: asString(row.gstin),
    pan: asString(row.pan),
    cin: asString(row.cin),

    contactPerson: asString(row.contact_person),
    mobile: asString(row.mobile),
    alternateMobile: asString(row.alternate_mobile),
    email: asString(row.email),
    website: asString(row.website),

    address: asString(row.address),
    city: asString(row.city),
    state: asString(row.state),
    pincode: asString(row.pincode),

    accountHolderName: asString(row.account_holder_name),
    bankName: asString(row.bank_name),
    bankBranch: asString(row.bank_branch),
    accountNumber: asString(row.account_number),
    ifsc: asString(row.ifsc),
    upiId: asString(row.upi_id),

    logoUrl: asString(row.logo_url),
    signatureUrl: asString(row.signature_url),
    stampUrl: asString(row.stamp_url),

    financialYear: asString(row.financial_year),
    lrPrefix: asString(row.lr_prefix),
    invoicePrefix: asString(row.invoice_prefix),
    voucherPrefix: asString(row.voucher_prefix),
    lrPrefixLength: asNumber(row.lr_prefix_length, 4),
    invoicePrefixLength: asNumber(row.invoice_prefix_length, 4),
    voucherPrefixLength: asNumber(row.voucher_prefix_length, 4),

    defaultBranch: asString(row.default_branch),
    defaultCurrency: (asString(row.default_currency) || "INR") as Company["defaultCurrency"],
    defaultFreightType: (asString(row.default_freight_type) || "Paid") as Company["defaultFreightType"],
    defaultGstPercentage: asNumber(row.default_gst_percentage, 0),

    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
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
   ASSET UPLOAD (Logo / Signature / Stamp)
   Requires a public "company-assets" Storage bucket to exist.
========================================================== */

export async function uploadCompanyAsset(
  file: File,
  kind: "logo" | "signature" | "stamp"
): Promise<string> {
  const extension = file.name.split(".").pop() ?? "png";
  const path = `${kind}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);

  return data.publicUrl;
}
