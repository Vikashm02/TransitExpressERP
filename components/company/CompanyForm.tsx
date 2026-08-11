"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/ui/PageHeader";
import FormSection from "@/components/ui/FormSection";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import DigitalSignaturePad from "./DigitalSignaturePad";

import {
  DEFAULT_BRANCH_OPTIONS,
  DEFAULT_CURRENCY_OPTIONS,
  DEFAULT_FREIGHT_TYPE_OPTIONS,
  companySchema,
  getCurrentFinancialYear,
  validateCompany,
  type Company,
} from "./company.schema";
import type { FieldErrors } from "@/lib/validation";
import {
  getCompany,
  saveCompany,
  uploadCompanyAsset,
} from "@/components/services/company.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const emptyCompany: Company = {
  companyName: "",
  companyShortName: "",
  gstin: "",
  pan: "",
  cin: "",

  contactPerson: "",
  mobile: "",
  alternateMobile: "",
  email: "",
  website: "",

  address: "",
  city: "",
  state: "",
  pincode: "",

  accountHolderName: "",
  bankName: "",
  bankBranch: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",

  logoUrl: "",
  signatureUrl: "",
  stampUrl: "",
  digitalSignatureUrl: "",

  financialYear: getCurrentFinancialYear(),
  lrPrefix: "",
  invoicePrefix: "",
  voucherPrefix: "",
  lrPrefixLength: 4,
  invoicePrefixLength: 4,
  voucherPrefixLength: 4,
  lrRunningNumber: 0,
  invoiceRunningNumber: 0,

  defaultBranch: DEFAULT_BRANCH_OPTIONS[0],
  defaultCurrency: DEFAULT_CURRENCY_OPTIONS[0],
  defaultFreightType: DEFAULT_FREIGHT_TYPE_OPTIONS[0],
  defaultGstPercentage: 0,
};

type AssetKind = "logo" | "signature" | "stamp" | "digital-signature";

const ASSET_LABELS: Record<AssetKind, string> = {
  logo: "Logo",
  signature: "Signature",
  stamp: "Stamp",
  "digital-signature": "Digital signature",
};

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

interface AssetUploadFieldProps {
  label: string;
  hint: string;
  value: string;
  uploading: boolean;
  onSelectFile: (file: File) => void;
}

function AssetUploadField({
  label,
  hint,
  value,
  uploading,
  onSelectFile,
}: AssetUploadFieldProps) {
  const inputId = `asset-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <FormField
      label={label}
      htmlFor={inputId}
    >
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt={label}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="px-1 text-center text-[10px] text-muted-foreground">
              No {label.toLowerCase()}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => document.getElementById(inputId)?.click()}
          >
            {uploading ? "Uploading..." : value ? "Replace" : "Upload"}
          </Button>

          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSelectFile(file);
              e.target.value = "";
            }}
          />

          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    </FormField>
  );
}

export default function CompanyForm() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("company", "edit");

  const [company, setCompany] = useState<Company>(emptyCompany);
  const [companyId, setCompanyId] = useState<number | undefined>(undefined);
  const [errors, setErrors] = useState<FieldErrors<Company>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Partial<Record<AssetKind, boolean>>>({});

  useEffect(() => {
    loadCompany();
  }, []);

  async function loadCompany() {
    try {
      setLoading(true);
      const record = await getCompany();

      if (record) {
        const { id, ...values } = record;
        setCompanyId(id);
        setCompany({ ...emptyCompany, ...values });
      }
    } catch (error) {
      console.error(error);
      toast.error("Unable to load company details.");
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof Company>(key: K, value: Company[K]) {
    setCompany((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAssetUpload(kind: AssetKind, file: File) {
    const fieldKey: keyof Company =
      kind === "logo"
        ? "logoUrl"
        : kind === "signature"
          ? "signatureUrl"
          : kind === "stamp"
            ? "stampUrl"
            : "digitalSignatureUrl";

    try {
      setUploading((prev) => ({ ...prev, [kind]: true }));
      const url = await uploadCompanyAsset(file, kind);
      update(fieldKey, url);
      toast.success(`${ASSET_LABELS[kind]} uploaded successfully.`);
    } catch (error) {
      console.error(error);
      toast.error(`Unable to upload ${ASSET_LABELS[kind].toLowerCase()}. Confirm the "company-assets" storage bucket exists.`);
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }));
    }
  }

  async function handleSave() {
    const fieldErrors = validateCompany(company);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      toast.error("Please fix the highlighted fields before saving.");
      return;
    }

    setErrors({});

    try {
      setSaving(true);
      const parsed = companySchema.parse(company);
      const saved = await saveCompany(parsed, companyId);
      setCompanyId(saved.id);
      toast.success("Company details saved successfully.");
    } catch (error) {
      console.error(error);
      toast.error("Unable to save company details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company"
        buttonText={saving ? "Saving..." : "Save Company"}
        onAdd={handleSave}
        disabled={loading || saving}
        showAddButton={canEdit}
      />

      <div className="space-y-6">
        <FormSection title="Company Identity">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Company Name"
              htmlFor="company-name"
              required
              error={errors.companyName}
            >
              <Input
                id="company-name"
                placeholder="Company Name"
                value={company.companyName}
                onChange={(e) => update("companyName", e.target.value)}
              />
            </FormField>

            <FormField
              label="Company Short Name"
              htmlFor="company-short-name"
              required
              error={errors.companyShortName}
            >
              <Input
                id="company-short-name"
                placeholder="Short Name"
                value={company.companyShortName}
                onChange={(e) => update("companyShortName", e.target.value)}
              />
            </FormField>

            <FormField
              label="GSTIN"
              htmlFor="company-gstin"
              error={errors.gstin}
            >
              <Input
                id="company-gstin"
                placeholder="GSTIN"
                value={company.gstin}
                onChange={(e) => update("gstin", e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField
              label="PAN"
              htmlFor="company-pan"
              error={errors.pan}
            >
              <Input
                id="company-pan"
                placeholder="PAN"
                value={company.pan}
                onChange={(e) => update("pan", e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField
              label="CIN"
              htmlFor="company-cin"
              error={errors.cin}
            >
              <Input
                id="company-cin"
                placeholder="CIN"
                value={company.cin}
                onChange={(e) => update("cin", e.target.value.toUpperCase())}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Contact">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Contact Person"
              htmlFor="company-contact-person"
            >
              <Input
                id="company-contact-person"
                placeholder="Contact Person"
                value={company.contactPerson}
                onChange={(e) => update("contactPerson", e.target.value)}
              />
            </FormField>

            <FormField
              label="Mobile"
              htmlFor="company-mobile"
              error={errors.mobile}
            >
              <Input
                id="company-mobile"
                placeholder="Mobile Number"
                value={company.mobile}
                onChange={(e) => update("mobile", e.target.value)}
              />
            </FormField>

            <FormField
              label="Alternate Mobile"
              htmlFor="company-alternate-mobile"
              error={errors.alternateMobile}
            >
              <Input
                id="company-alternate-mobile"
                placeholder="Alternate Mobile Number"
                value={company.alternateMobile}
                onChange={(e) => update("alternateMobile", e.target.value)}
              />
            </FormField>

            <FormField
              label="Email"
              htmlFor="company-email"
              error={errors.email}
            >
              <Input
                id="company-email"
                type="email"
                placeholder="Email"
                value={company.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </FormField>

            <FormField
              label="Website"
              htmlFor="company-website"
              error={errors.website}
            >
              <Input
                id="company-website"
                placeholder="Website"
                value={company.website}
                onChange={(e) => update("website", e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Address">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Address"
              htmlFor="company-address"
              className="sm:col-span-2"
            >
              <Textarea
                id="company-address"
                placeholder="Company Address"
                value={company.address}
                onChange={(e) => update("address", e.target.value)}
              />
            </FormField>

            <FormField
              label="City"
              htmlFor="company-city"
            >
              <Input
                id="company-city"
                placeholder="City"
                value={company.city}
                onChange={(e) => update("city", e.target.value)}
              />
            </FormField>

            <FormField
              label="State"
              htmlFor="company-state"
            >
              <Input
                id="company-state"
                placeholder="State"
                value={company.state}
                onChange={(e) => update("state", e.target.value)}
              />
            </FormField>

            <FormField
              label="Pincode"
              htmlFor="company-pincode"
              error={errors.pincode}
            >
              <Input
                id="company-pincode"
                placeholder="Pincode"
                value={company.pincode}
                onChange={(e) => update("pincode", e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Banking">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Account Holder Name"
              htmlFor="company-account-holder"
            >
              <Input
                id="company-account-holder"
                placeholder="Account Holder Name"
                value={company.accountHolderName}
                onChange={(e) => update("accountHolderName", e.target.value)}
              />
            </FormField>

            <FormField
              label="Bank Name"
              htmlFor="company-bank-name"
            >
              <Input
                id="company-bank-name"
                placeholder="Bank Name"
                value={company.bankName}
                onChange={(e) => update("bankName", e.target.value)}
              />
            </FormField>

            <FormField
              label="Bank Branch"
              htmlFor="company-bank-branch"
            >
              <Input
                id="company-bank-branch"
                placeholder="Bank Branch"
                value={company.bankBranch}
                onChange={(e) => update("bankBranch", e.target.value)}
              />
            </FormField>

            <FormField
              label="Account Number"
              htmlFor="company-account-number"
              error={errors.accountNumber}
            >
              <Input
                id="company-account-number"
                placeholder="Account Number"
                value={company.accountNumber}
                onChange={(e) => update("accountNumber", e.target.value)}
              />
            </FormField>

            <FormField
              label="IFSC"
              htmlFor="company-ifsc"
              error={errors.ifsc}
            >
              <Input
                id="company-ifsc"
                placeholder="IFSC Code"
                value={company.ifsc}
                onChange={(e) => update("ifsc", e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField
              label="UPI ID"
              htmlFor="company-upi"
              error={errors.upiId}
            >
              <Input
                id="company-upi"
                placeholder="UPI ID"
                value={company.upiId}
                onChange={(e) => update("upiId", e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          title="Branding"
          subtitle="Used on printed LR, invoices, and reports once available."
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <AssetUploadField
              label="Company Logo"
              hint="PNG or JPG, up to 2MB."
              value={company.logoUrl}
              uploading={Boolean(uploading.logo)}
              onSelectFile={(file) => handleAssetUpload("logo", file)}
            />

            <AssetUploadField
              label="Authorized Signature"
              hint="PNG or JPG, up to 2MB."
              value={company.signatureUrl}
              uploading={Boolean(uploading.signature)}
              onSelectFile={(file) => handleAssetUpload("signature", file)}
            />

            <AssetUploadField
              label="Company Stamp"
              hint="PNG or JPG, up to 2MB."
              value={company.stampUrl}
              uploading={Boolean(uploading.stamp)}
              onSelectFile={(file) => handleAssetUpload("stamp", file)}
            />
          </div>
        </FormSection>

        <FormSection
          title="Digital Signature"
          subtitle="Draw the authorized person's signature for reuse wherever a company digital signature is required."
        >
          <DigitalSignaturePad
            value={company.digitalSignatureUrl}
            saving={Boolean(uploading["digital-signature"])}
            onSave={(file) => handleAssetUpload("digital-signature", file)}
          />
        </FormSection>

        <FormSection title="Document Settings">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FormField
              label="Financial Year"
              htmlFor="company-financial-year"
              required
              error={errors.financialYear}
              hint="Format: YYYY-YY, e.g. 2025-26"
            >
              <Input
                id="company-financial-year"
                placeholder="2025-26"
                value={company.financialYear}
                onChange={(e) => update("financialYear", e.target.value)}
              />
            </FormField>

            <FormField
              label="LR Prefix"
              htmlFor="company-lr-prefix"
              error={errors.lrPrefix}
            >
              <Input
                id="company-lr-prefix"
                placeholder="e.g. TXE"
                value={company.lrPrefix}
                onChange={(e) => update("lrPrefix", e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField
              label="LR Prefix Length"
              htmlFor="company-lr-prefix-length"
              error={errors.lrPrefixLength}
              hint="Digits used to pad the running sequence."
            >
              <Input
                id="company-lr-prefix-length"
                type="number"
                min={1}
                max={10}
                value={company.lrPrefixLength}
                onChange={(e) => update("lrPrefixLength", Number(e.target.value))}
              />
            </FormField>

            <FormField
              label="Current LR Running Number"
              htmlFor="company-lr-running-number"
              error={errors.lrRunningNumber}
              hint="Last used sequence number. The next LR uses this + 1."
            >
              <Input
                id="company-lr-running-number"
                type="number"
                min={0}
                value={company.lrRunningNumber}
                onChange={(e) => update("lrRunningNumber", Number(e.target.value))}
              />
            </FormField>

            <FormField
              label="Invoice Prefix"
              htmlFor="company-invoice-prefix"
              error={errors.invoicePrefix}
            >
              <Input
                id="company-invoice-prefix"
                placeholder="e.g. INV"
                value={company.invoicePrefix}
                onChange={(e) => update("invoicePrefix", e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField
              label="Invoice Prefix Length"
              htmlFor="company-invoice-prefix-length"
              error={errors.invoicePrefixLength}
              hint="Digits used to pad the running sequence."
            >
              <Input
                id="company-invoice-prefix-length"
                type="number"
                min={1}
                max={10}
                value={company.invoicePrefixLength}
                onChange={(e) => update("invoicePrefixLength", Number(e.target.value))}
              />
            </FormField>

            <FormField
              label="Current Invoice Running Number"
              htmlFor="company-invoice-running-number"
              error={errors.invoiceRunningNumber}
              hint="Last used sequence number. The next invoice uses this + 1."
            >
              <Input
                id="company-invoice-running-number"
                type="number"
                min={0}
                value={company.invoiceRunningNumber}
                onChange={(e) => update("invoiceRunningNumber", Number(e.target.value))}
              />
            </FormField>

            <FormField
              label="Voucher Prefix"
              htmlFor="company-voucher-prefix"
              error={errors.voucherPrefix}
            >
              <Input
                id="company-voucher-prefix"
                placeholder="e.g. VCH"
                value={company.voucherPrefix}
                onChange={(e) => update("voucherPrefix", e.target.value.toUpperCase())}
              />
            </FormField>

            <FormField
              label="Voucher Prefix Length"
              htmlFor="company-voucher-prefix-length"
              error={errors.voucherPrefixLength}
              hint="Digits used to pad the running sequence."
            >
              <Input
                id="company-voucher-prefix-length"
                type="number"
                min={1}
                max={10}
                value={company.voucherPrefixLength}
                onChange={(e) => update("voucherPrefixLength", Number(e.target.value))}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="System Defaults">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormSelect
              label="Default Branch"
              id="company-default-branch"
              value={company.defaultBranch}
              onValueChange={(value) => update("defaultBranch", value)}
              options={toOptions(DEFAULT_BRANCH_OPTIONS)}
            />

            <FormSelect
              label="Default Currency"
              id="company-default-currency"
              value={company.defaultCurrency}
              onValueChange={(value) => update("defaultCurrency", value as Company["defaultCurrency"])}
              options={toOptions(DEFAULT_CURRENCY_OPTIONS)}
            />

            <FormSelect
              label="Default Freight Type"
              id="company-default-freight-type"
              value={company.defaultFreightType}
              onValueChange={(value) =>
                update("defaultFreightType", value as Company["defaultFreightType"])
              }
              options={toOptions(DEFAULT_FREIGHT_TYPE_OPTIONS)}
            />

            <FormField
              label="Default GST Percentage"
              htmlFor="company-default-gst"
              error={errors.defaultGstPercentage}
            >
              <Input
                id="company-default-gst"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={company.defaultGstPercentage}
                onChange={(e) => update("defaultGstPercentage", Number(e.target.value))}
              />
            </FormField>
          </div>
        </FormSection>
      </div>
    </div>
  );
}
