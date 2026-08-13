"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import LRLookup from "@/components/lookup/LRLookup";
import type { LRRecord } from "@/components/services/lr.service";
import type { AsnRecord } from "@/components/services/asn.service";
import {
  applyLrToAsn,
  uploadAsnSlip,
  type AsnSlipKind,
} from "@/components/services/asn.service";
import {
  calcSupplierGrossWeight,
  validateAsn,
  type Asn,
} from "./asn.schema";
import type { FieldErrors } from "@/lib/validation";
import { pickFields } from "@/lib/utils";

export type AsnDialogMode = "create" | "edit" | "view";

interface AsnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AsnDialogMode;
  asn?: AsnRecord | null;
  loading?: boolean;
  onSubmit: (values: Asn) => void | Promise<void>;
}

const emptyState: Asn = {
  asnNumber: "",
  asnDate: format(new Date(), "yyyy-MM-dd"),
  lrNumber: "",
  lrDate: "",
  vehicleNumber: "",
  driverName: "",
  driverContact: "",
  challanInvoiceNumber: "",
  challanInvoiceDate: "",
  supplierTareWeight: 0,
  supplierNetWeight: 0,
  supplierGrossWeight: 0,
  challanQty: 0,
  expectedTimeOfArrival: "",
  roadPermit: "",
  weightmentSlipUrl: "",
  challanCopySlipUrl: "",
  lrCopySlipUrl: "",
};

function toEditable(record: AsnRecord): Asn {
  return pickFields(record, Object.keys(emptyState) as (keyof Asn)[]);
}

/** Convert ISO / timestamptz to datetime-local value. */
function toDateTimeLocal(value: string): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value.slice(0, 16);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return value.slice(0, 16);
  }
}

/** datetime-local → ISO string for storage. */
function fromDateTimeLocal(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

function SlipField({
  label,
  url,
  readOnly,
  uploading,
  onUpload,
}: {
  label: string;
  url: string;
  readOnly: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <FormField label={label} htmlFor={`asn-${label}`}>
      <div className="space-y-2">
        {url ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground truncate max-w-[220px]">
              {url.split("/").pop() || "Uploaded"}
            </span>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
            >
              View
            </a>
            <a
              href={url}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
            >
              Download
            </a>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No file uploaded</p>
        )}
        {!readOnly && (
          <Input
            id={`asn-${label}`}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
        )}
      </div>
    </FormField>
  );
}

export default function AsnDialog({
  open,
  onOpenChange,
  mode,
  asn,
  loading = false,
  onSubmit,
}: AsnDialogProps) {
  const [values, setValues] = useState<Asn>(emptyState);
  const [errors, setErrors] = useState<FieldErrors<Asn>>({});
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lrFetched, setLrFetched] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<AsnSlipKind | null>(null);

  const readOnly = mode === "view";

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (asn) {
      setValues(toEditable(asn));
      setLrFetched(true);
    } else {
      setValues({
        ...emptyState,
        asnDate: format(new Date(), "yyyy-MM-dd"),
      });
      setLrFetched(false);
    }
  }, [open, asn]);

  function update<K extends keyof Asn>(key: K, value: Asn[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "supplierTareWeight" || key === "supplierNetWeight") {
        next.supplierGrossWeight = calcSupplierGrossWeight(
          key === "supplierTareWeight"
            ? (value as number)
            : next.supplierTareWeight,
          key === "supplierNetWeight"
            ? (value as number)
            : next.supplierNetWeight
        );
      }
      return next;
    });
  }

  function handleSelectLR(lr: LRRecord) {
    setValues((current) => applyLrToAsn(current, lr));
    setLrFetched(true);
    setLookupOpen(false);
  }

  function handleClearLR() {
    if (readOnly) return;
    setValues((current) => ({
      ...emptyState,
      asnNumber: current.asnNumber,
      asnDate: current.asnDate,
      expectedTimeOfArrival: current.expectedTimeOfArrival,
      roadPermit: current.roadPermit,
      supplierTareWeight: current.supplierTareWeight,
      weightmentSlipUrl: current.weightmentSlipUrl,
      challanCopySlipUrl: current.challanCopySlipUrl,
      lrCopySlipUrl: current.lrCopySlipUrl,
      supplierGrossWeight: calcSupplierGrossWeight(current.supplierTareWeight, 0),
    }));
    setLrFetched(false);
    setErrors({});
  }

  async function handleUpload(kind: AsnSlipKind, file: File) {
    try {
      setUploadingKind(kind);
      const url = await uploadAsnSlip(file, kind);
      if (kind === "weightment") update("weightmentSlipUrl", url);
      if (kind === "challan-copy") update("challanCopySlipUrl", url);
      if (kind === "lr-copy") update("lrCopySlipUrl", url);
      toast.success("File uploaded.");
    } catch (err) {
      console.error(err);
      toast.error("Unable to upload file.");
    } finally {
      setUploadingKind(null);
    }
  }

  function handleSave() {
    const fieldErrors = validateAsn(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    onSubmit({
      ...values,
      supplierGrossWeight: calcSupplierGrossWeight(
        values.supplierTareWeight,
        values.supplierNetWeight
      ),
    });
  }

  const title =
    mode === "create"
      ? "Create ASN"
      : mode === "edit"
        ? "Edit ASN"
        : "View ASN";

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        size="lg"
        description="Select an LR to auto-fill vehicle, driver, weights and document numbers. Enter tare weight, ETA, road permit and upload slips."
        loading={loading}
        loadingText="Saving ASN..."
        footer={
          readOnly ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading || !lrFetched || uploadingKind !== null}
              >
                {loading ? "Saving..." : "Save ASN"}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">ASN</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="ASN Number" htmlFor="asn-number">
                <Input
                  id="asn-number"
                  readOnly
                  value={
                    values.asnNumber ||
                    (mode === "create" ? "Auto-generated on save" : "")
                  }
                />
              </FormField>
              <FormDatePicker
                label="ASN Date"
                id="asn-date"
                required
                error={errors.asnDate}
                value={values.asnDate}
                onChange={(v) => update("asnDate", v)}
                disabled={readOnly}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">LR Selection</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="LR Number"
                htmlFor="asn-lr-number"
                required
                error={errors.lrNumber}
                hint="Select an existing LR to auto-fill derived fields."
              >
                <div className="flex gap-2">
                  <Input
                    id="asn-lr-number"
                    readOnly
                    placeholder="Select LR"
                    value={values.lrNumber}
                  />
                  {!readOnly && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setLookupOpen(true)}
                        disabled={loading}
                      >
                        Search
                      </Button>
                      {lrFetched && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleClearLR}
                          disabled={loading}
                        >
                          Clear
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </FormField>
              <FormDatePicker
                label="LR Date"
                id="asn-lr-date"
                hint={lrFetched ? "Auto-filled from LR" : undefined}
                value={values.lrDate}
                onChange={(v) => update("lrDate", v)}
                disabled={readOnly}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">LR details</h3>
            <p className="text-xs text-muted-foreground">
              Auto-filled from LR — editable if you need to override.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Vehicle Number" htmlFor="asn-vehicle">
                <Input
                  id="asn-vehicle"
                  readOnly={readOnly}
                  value={values.vehicleNumber}
                  onChange={(e) => update("vehicleNumber", e.target.value)}
                />
              </FormField>
              <FormField label="Driver Name" htmlFor="asn-driver">
                <Input
                  id="asn-driver"
                  readOnly={readOnly}
                  value={values.driverName}
                  onChange={(e) => update("driverName", e.target.value)}
                />
              </FormField>
              <FormField label="Driver Contact Number" htmlFor="asn-driver-contact">
                <Input
                  id="asn-driver-contact"
                  readOnly={readOnly}
                  value={values.driverContact}
                  onChange={(e) => update("driverContact", e.target.value)}
                />
              </FormField>
              <FormField
                label="Challan No. / Invoice Number"
                htmlFor="asn-challan-inv"
              >
                <Input
                  id="asn-challan-inv"
                  readOnly={readOnly}
                  value={values.challanInvoiceNumber}
                  onChange={(e) =>
                    update("challanInvoiceNumber", e.target.value)
                  }
                />
              </FormField>
              <FormDatePicker
                label="Challan / Invoice Date"
                id="asn-challan-inv-date"
                value={values.challanInvoiceDate}
                onChange={(v) => update("challanInvoiceDate", v)}
                disabled={readOnly}
              />
              <FormField
                label="Supplier Net Weight (MT)"
                htmlFor="asn-net"
                error={errors.supplierNetWeight}
              >
                <BlankableNumberInput
                  id="asn-net"
                  value={values.supplierNetWeight}
                  onChange={(v) => update("supplierNetWeight", v)}
                  readOnly={readOnly}
                  blankWhenZero={mode === "create" && !lrFetched}
                  min={0}
                  step="0.001"
                />
              </FormField>
              <FormField
                label="Challan Qty (MT)"
                htmlFor="asn-challan-qty"
                error={errors.challanQty}
              >
                <BlankableNumberInput
                  id="asn-challan-qty"
                  value={values.challanQty}
                  onChange={(v) => update("challanQty", v)}
                  readOnly={readOnly}
                  blankWhenZero={mode === "create" && !lrFetched}
                  min={0}
                  step="0.001"
                />
              </FormField>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Weights & schedule</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Supplier Tare Weight (MT)"
                htmlFor="asn-tare"
                required
                error={errors.supplierTareWeight}
              >
                <BlankableNumberInput
                  id="asn-tare"
                  value={values.supplierTareWeight}
                  onChange={(v) => update("supplierTareWeight", v)}
                  readOnly={readOnly}
                  blankWhenZero={mode === "create"}
                  min={0}
                  step="0.001"
                />
              </FormField>
              <FormField label="Supplier Gross Weight (MT)" htmlFor="asn-gross">
                <Input
                  id="asn-gross"
                  readOnly
                  value={Number(values.supplierGrossWeight).toFixed(3)}
                />
              </FormField>
              <FormField
                label="Expected Time of Arrival"
                htmlFor="asn-eta"
                required
                error={errors.expectedTimeOfArrival}
              >
                <Input
                  id="asn-eta"
                  type="datetime-local"
                  disabled={readOnly}
                  value={toDateTimeLocal(values.expectedTimeOfArrival)}
                  onChange={(e) =>
                    update("expectedTimeOfArrival", fromDateTimeLocal(e.target.value))
                  }
                />
              </FormField>
              <FormField
                label="Road Permit"
                htmlFor="asn-road-permit"
                required
                error={errors.roadPermit}
              >
                <Input
                  id="asn-road-permit"
                  disabled={readOnly}
                  value={values.roadPermit}
                  onChange={(e) => update("roadPermit", e.target.value)}
                />
              </FormField>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Uploads</h3>
            <div className="grid grid-cols-1 gap-4">
              <SlipField
                label="Weightment Slip"
                url={values.weightmentSlipUrl}
                readOnly={readOnly}
                uploading={uploadingKind === "weightment"}
                onUpload={(f) => handleUpload("weightment", f)}
              />
              <SlipField
                label="Challan Copy Slip"
                url={values.challanCopySlipUrl}
                readOnly={readOnly}
                uploading={uploadingKind === "challan-copy"}
                onUpload={(f) => handleUpload("challan-copy", f)}
              />
              <SlipField
                label="LR Copy Slip"
                url={values.lrCopySlipUrl}
                readOnly={readOnly}
                uploading={uploadingKind === "lr-copy"}
                onUpload={(f) => handleUpload("lr-copy", f)}
              />
            </div>
          </section>
        </div>
      </FormDialog>

      <LRLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleSelectLR}
      />
    </>
  );
}
