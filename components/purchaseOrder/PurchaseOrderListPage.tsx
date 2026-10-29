"use client";

import { useCallback, useEffect, useState } from "react";
import { exportCsv, formatCreatedOn, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { BadgeCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import MasterAutocomplete from "@/components/lookup/MasterAutocomplete";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { purchaseOrderUsage, purchaseOrderWarningClass } from "@/lib/purchaseOrderUsage";
import { purchaseOrderSchema, type PurchaseOrder } from "./purchaseOrder.schema";
import { getPurchaseOrders, getPurchaseOrderParties, getPurchaseOrderCustomers, getPurchaseOrderMaterials, savePurchaseOrder,
  makePurchaseOrderPermanent, type PurchaseOrderRecord, type PurchaseOrderParty } from "@/components/services/purchaseOrder.service";

/** Export = PO form fields in form order, then the usage figures shown on the page. */
const PO_EXPORT_COLUMNS: ExportColumn<PurchaseOrderRecord>[] = [
  { header: "Billing Party", value: (r) => r.billingPartyName },
  { header: "Consignor", value: (r) => r.consignor },
  { header: "Consignee", value: (r) => r.consignee },
  { header: "Material", value: (r) => r.materialName },
  { header: "PO Number", value: (r) => r.poNumber },
  { header: "Issue Date", value: (r) => r.issueDate },
  { header: "Allotted Weight (MT)", value: (r) => (r.allottedWeight > 0 ? r.allottedWeight : "Not set") },
  { header: "Status", value: (r) => r.status },
  { header: "PO Type", value: (r) => (r.isTemporary ? "Temporary" : "Permanent") },
  { header: "Temporary Since", value: (r) => (r.isTemporary && r.temporarySince ? formatCreatedOn(r.temporarySince) : "") },
  { header: "Used (MT)", value: (r) => r.usedWeight },
  { header: "Remaining (MT)", value: (r) => (r.allottedWeight > 0 ? Math.max(0, purchaseOrderUsage(r.allottedWeight, r.usedWeight).remaining) : "") },
  { header: "Excess (MT)", value: (r) => (r.allottedWeight > 0 ? purchaseOrderUsage(r.allottedWeight, r.usedWeight).exceeded : "") },
  { header: "Usage %", value: (r) => (r.allottedWeight > 0 ? Number(purchaseOrderUsage(r.allottedWeight, r.usedWeight).percent.toFixed(1)) : "") },
];

const empty: PurchaseOrder = { billingPartyId: 0, materialId: null, consignor: "", consigneeId: 0, poNumber: "", issueDate: "", allottedWeight: 0, status: "Active", isTemporary: false };
const weight = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
/** Reminders start once a Temporary PO is this many days old (migration 118). */
const TEMPORARY_REMINDER_DAYS = 3;

/** Whole days a Temporary PO has been pending (India calendar days). */
function daysPending(since: string | null): number {
  if (!since) return 0;
  const toIstDay = (d: Date) => Math.floor((d.getTime() + 5.5 * 3600 * 1000) / 86400000);
  return Math.max(0, toIstDay(new Date()) - toIstDay(new Date(since)));
}

function TemporaryBadge({ since }: { since: string | null }) {
  const days = daysPending(since);
  const overdue = days >= TEMPORARY_REMINDER_DAYS;
  const sinceLabel = since
    ? new Date(since).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })
    : "";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${
        overdue
          ? "bg-destructive/10 text-destructive ring-destructive/30"
          : "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/40"
      }`}
    >
      Temporary{sinceLabel ? ` · since ${sinceLabel}` : ""} · {days === 1 ? "1 day" : `${days} days`}
    </span>
  );
}

export default function PurchaseOrderListPage() {
  const { hasAction } = useAuth();
  const [rows, setRows] = useState<PurchaseOrderRecord[]>([]);
  const [parties, setParties] = useState<PurchaseOrderParty[]>([]);
  const [materials, setMaterials] = useState<{ id: number; name: string }[]>([]);
  const [customers, setCustomers] = useState<PurchaseOrderParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  /** "" = all, "temporary" or "permanent". Opened as ?type=temporary from reminders. */
  const [poType, setPoType] = useState("");
  const [permanentTarget, setPermanentTarget] = useState<PurchaseOrderRecord | null>(null);
  const [permanentNumber, setPermanentNumber] = useState("");
  const [permanentDate, setPermanentDate] = useState("");
  const [permanentError, setPermanentError] = useState("");
  const [makingPermanent, setMakingPermanent] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrderRecord | null>(null);
  const [values, setValues] = useState<PurchaseOrder>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canCreate = hasAction("purchase_orders", "create");
  const canEdit = hasAction("purchase_orders", "edit");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getPurchaseOrders());
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPurchaseOrders().then((data) => {
      if (cancelled) return;
      setRows(data);
      // Reminder notifications open PO Master with ?type=temporary.
      const type = new URLSearchParams(window.location.search).get("type");
      if (type === "temporary" || type === "permanent") setPoType(type);
    })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function showForm(record: PurchaseOrderRecord | null) {
    try {
      const [partyRows, customerRows, materialRows] = await Promise.all([getPurchaseOrderParties(), getPurchaseOrderCustomers(), getPurchaseOrderMaterials()]);
      setMaterials(materialRows);
      setParties(partyRows);
      setCustomers(customerRows);
      setEditing(record);
      setValues(record ? {
        billingPartyId: record.billingPartyId, materialId: record.materialId ?? null, poNumber: record.poNumber,
        consignor: record.consignor, consigneeId: record.consigneeId ?? 0, issueDate: record.issueDate, allottedWeight: record.allottedWeight, status: record.status,
        isTemporary: record.isTemporary,
      } : { ...empty });
      setErrors({});
      setOpen(true);
    } catch { toast.error("Unable to load billing parties for PO entry."); }
  }

  async function save() {
    if ((!editing || editing.materialId != null) && values.materialId == null) {
      setErrors({ materialId: "Select Material from Material Master." });
      return;
    }
    const parsed = purchaseOrderSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setSaving(true);
    try {
      await savePurchaseOrder(editing?.id ?? null, parsed.data);
      setOpen(false);
      toast.success(editing ? "PO updated." : "PO created.");
      await refresh();
    } catch (error) {
      const code = (error as { code?: string }).code;
      toast.error(code === "23505" ? "This billing party already has that PO number."
        : getUserFacingError(error, "Unable to save PO. Check your permissions; the party and number of a linked PO cannot be changed."));
    } finally { setSaving(false); }
  }

  function openMakePermanent(record: PurchaseOrderRecord) {
    setPermanentTarget(record);
    setPermanentNumber("");
    setPermanentDate(record.issueDate);
    setPermanentError("");
  }

  async function confirmMakePermanent() {
    if (!permanentTarget) return;
    const number = permanentNumber.trim().toUpperCase();
    if (!number) return setPermanentError("Enter the permanent PO number.");
    if (number === permanentTarget.poNumber) return setPermanentError("Enter the new permanent number (it is the same as the temporary one).");
    if (!permanentDate) return setPermanentError("Enter the permanent PO date.");
    setMakingPermanent(true);
    try {
      const result = await makePurchaseOrderPermanent(permanentTarget.id, number, permanentDate);
      setPermanentTarget(null);
      toast.success(
        `PO ${result.oldPoNumber} is now permanent PO ${result.newPoNumber}. ` +
          (result.lrsUpdated === 1 ? "1 LR updated." : `${result.lrsUpdated} LRs updated.`)
      );
      if (result.billsWithOldNumber.length > 0) {
        toast.warning(
          `Bills already made with the temporary number were not changed: ${result.billsWithOldNumber
            .map((b) => b.billNumber)
            .join(", ")}. Please review them in Billing.`,
          { duration: 15000 }
        );
      }
      await refresh();
    } catch (error) {
      setPermanentError(getUserFacingError(error, "Could not make this PO permanent. Nothing was changed."));
    } finally {
      setMakingPermanent(false);
    }
  }

  // Landing order: highest usage % first so POs closest to (or over) their
  // allotted weight are seen immediately; ties by used weight, then newest.
  const usagePercent = (r: PurchaseOrderRecord) => purchaseOrderUsage(r.allottedWeight, r.usedWeight).percent;
  const temporaryCount = rows.filter((r) => r.isTemporary).length;
  const filtered = rows.filter((r) => (!status || r.status === status)
    && (!poType || (poType === "temporary" ? r.isTemporary : !r.isTemporary))
    && matchesListSearch(search, [r.poNumber, r.billingPartyName, r.consignor, r.consignee, r.materialName, r.issueDate, r.allottedWeight, r.usedWeight, r.status,
      r.isTemporary ? "Temporary" : "Permanent"]))
    .sort((a, b) => usagePercent(b) - usagePercent(a) || b.usedWeight - a.usedWeight || b.id - a.id);
  const columns: DataTableColumn<PurchaseOrderRecord>[] = [
    { key: "poNumber", header: "PO Number", sortable: true, render: (r) => (
      <div className="flex flex-col items-start gap-1">
        <span className="font-medium">{r.poNumber}</span>
        {r.isTemporary ? <TemporaryBadge since={r.temporarySince} /> : null}
      </div>
    ) },
    { key: "billingPartyName", header: "Billing Party", sortable: true },
    { key: "consignor", header: "Consignor", sortable: true },
    { key: "consignee", header: "Consignee", sortable: true, render: (r) => r.consignee || "Not assigned (legacy)" },
    { key: "materialName", header: "Material", sortable: true, render: (r) => r.materialName || "Not assigned (legacy)" },
    { key: "issueDate", header: "Issue Date", sortable: true },
    { key: "allottedWeight", header: "Allotted (MT)", render: (r) => weight(r.allottedWeight), sortable: true },
    { key: "usedWeight", header: "Used (MT)", render: (r) => weight(r.usedWeight), sortable: true },
    { key: "remaining", header: "Remaining / Excess (MT)", render: (r) => {
      if (!(r.allottedWeight > 0)) return "Allotted weight not set";
      const u = purchaseOrderUsage(r.allottedWeight, r.usedWeight);
      return u.exceeded > 0 ? `${weight(u.exceeded)} over allotted` : weight(u.remaining);
    } },
    { key: "usage", header: "Usage", sortable: true, sortAccessor: usagePercent, render: (r) => {
      // Without an allotted weight there is no limit, so usage % and alerts cannot work.
      if (!(r.allottedWeight > 0)) return "Not measurable · set allotted weight to enable alerts";
      const u = purchaseOrderUsage(r.allottedWeight, r.usedWeight);
      const label = u.percent > 100 ? " · Limit exceeded" : u.percent >= 95 ? " · Critical"
        : u.warning === "red" ? " · High usage" : u.warning === "yellow" ? " · Near limit" : "";
      return `${u.percent.toFixed(1)}%${label}`;
    } },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

  return <div className="space-y-6">
    <PageHeader title="PO Master" buttonText="Add PO" showAddButton={canCreate}
      onAdd={() => void showForm(null)}
      subtitle="Loading weight from final, non-cancelled LRs. Active / Inactive is always set manually." />
    <p className="text-sm text-muted-foreground">Sorted by usage, highest first. Yellow: 80–90% used. Red: above 90%. Exceeding the allotted weight does not close the PO.</p>
    <SearchToolbar search={search} onSearchChange={setSearch} placeholder="Search PO number, party, consignor, consignee, material..."
      onRefresh={refresh}
      onExport={() => exportCsv("purchase-orders", PO_EXPORT_COLUMNS, filtered)}
      filters={[
        { key: "status", label: "Status", value: status, placeholder: "All statuses",
          options: ["Active", "Inactive"].map((s) => ({ label: s, value: s })), onChange: setStatus },
        { key: "type", label: "PO Type", value: poType, placeholder: "All PO types",
          options: [{ label: "Permanent", value: "permanent" }, { label: `Temporary (${temporaryCount})`, value: "temporary" }],
          onChange: setPoType },
      ]} />
    {temporaryCount > 0 && poType !== "temporary" ? (
      <button type="button" onClick={() => setPoType("temporary")}
        className="w-full rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-2.5 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        {temporaryCount === 1 ? "1 temporary PO is" : `${temporaryCount} temporary POs are`} waiting for the permanent PO number. Show them
      </button>
    ) : null}
    {loadError ? <p role="alert" className="text-sm text-destructive">Unable to load PO data. Refresh or contact your administrator; displayed data may be outdated.</p> : null}
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} loading={loading} pageSize={10}
      emptyTitle="No purchase orders found" sortable
      getRowClassName={(r) => purchaseOrderWarningClass(r.allottedWeight, r.usedWeight)}
      actions={canEdit ? [
        { label: "Make Permanent", icon: BadgeCheck, onClick: openMakePermanent, hidden: (r) => !r.isTemporary },
        { label: "Edit", icon: Pencil, onClick: (r) => void showForm(r), variant: "outline" },
      ] : []} />
    <FormDialog open={open} onOpenChange={setOpen} title={editing ? "Edit PO" : "Add PO"} loading={saving}
      footer={<><Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={saving} onClick={() => void save()}>Save PO</Button></>}>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Billing Party" htmlFor="po-party" required error={errors.billingPartyId}>
          <MasterAutocomplete id="po-party" value={values.billingPartyId ? (parties.find((p) => p.id === values.billingPartyId)?.name ?? editing?.billingPartyName ?? "") : ""}
            options={parties.map((p) => ({ id: p.id, label: p.name, description: p.code }))}
            onSelect={(p) => setValues({ ...values, billingPartyId: Number(p.id) })}
            onClear={() => setValues({ ...values, billingPartyId: 0 })} placeholder="Select billing party..." />
        </FormField>
        <FormField label="Consignor" htmlFor="po-consignor" required error={errors.consignor}>
          <MasterAutocomplete id="po-consignor" value={values.consignor}
            options={customers.map((row) => ({ id: row.id, label: row.name, description: row.code }))}
            onSelect={(row) => setValues({ ...values, consignor: row.label })}
            onClear={() => setValues({ ...values, consignor: "" })} placeholder="Select consignor..." />
        </FormField>
        <FormField label="Consignee" htmlFor="po-consignee" required error={errors.consigneeId}>
          <MasterAutocomplete id="po-consignee" value={values.consigneeId ? (customers.find((p) => p.id === values.consigneeId)?.name ?? editing?.consignee ?? "") : ""}
            options={customers.map((row) => ({ id: row.id, label: row.name, description: row.code }))}
            onSelect={(row) => setValues({ ...values, consigneeId: Number(row.id) })}
            onClear={() => setValues({ ...values, consigneeId: 0 })} placeholder="Select consignee..." />
        </FormField>
        <FormSelect label="Material" id="po-material" value={values.materialId == null ? "" : String(values.materialId)}
          required={!editing || editing.materialId != null} error={errors.materialId}
          placeholder="Select Material"
          options={[
            ...(values.materialId != null && !materials.some((m) => m.id === values.materialId)
              ? [{ value: String(values.materialId), label: editing?.materialName || "Existing Material" }] : []),
            ...materials.map((m) => ({ value: String(m.id), label: m.name })),
          ]}
          onValueChange={(id) => { if (id) setValues({ ...values, materialId: Number(id) }); }} />
        <FormSelect label="PO Type" id="po-type" value={values.isTemporary ? "temporary" : "permanent"}
          disabled={Boolean(editing?.isTemporary)}
          hint={editing?.isTemporary
            ? "To enter the permanent number, close this and click Make Permanent on the list. It also updates the LRs."
            : "Choose Temporary when the real PO number will come later."}
          options={[{ label: "Permanent", value: "permanent" }, { label: "Temporary", value: "temporary" }]}
          onValueChange={(t) => setValues({ ...values, isTemporary: t === "temporary" })} />
        <FormField label="PO Number" htmlFor="po-number" required error={errors.poNumber}
          hint={editing?.isTemporary ? "Temporary number. Use Make Permanent to replace it everywhere." : undefined}>
          <Input id="po-number" value={values.poNumber} maxLength={100} disabled={Boolean(editing?.isTemporary)}
            onChange={(e) => setValues({ ...values, poNumber: e.target.value.toUpperCase() })} />
        </FormField>
        <FormDatePicker label="Issue Date" id="po-date" required error={errors.issueDate}
          value={values.issueDate} onChange={(issueDate) => setValues({ ...values, issueDate })} />
        <FormField label="Allotted Weight (MT)" htmlFor="po-weight" error={errors.allottedWeight} hint="Leave blank until the allotted weight is known.">
          <Input id="po-weight" type="number" min="0" step="any" value={values.allottedWeight || ""}
            onChange={(e) => setValues({ ...values, allottedWeight: Number(e.target.value) })} />
        </FormField>
        <FormSelect label="Status" id="po-status" value={values.status}
          options={["Active", "Inactive"].map((s) => ({ label: s, value: s }))}
          onValueChange={(s) => setValues({ ...values, status: s as PurchaseOrder["status"] })} />
      </div>
    </FormDialog>
    <FormDialog open={permanentTarget !== null} onOpenChange={(o) => { if (!o && !makingPermanent) setPermanentTarget(null); }}
      title="Make PO Permanent" loading={makingPermanent}
      footer={<><Button variant="outline" disabled={makingPermanent} onClick={() => setPermanentTarget(null)}>Cancel</Button>
        <Button disabled={makingPermanent} onClick={() => void confirmMakePermanent()}>Make Permanent</Button></>}>
      {permanentTarget ? <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
          <p><span className="text-muted-foreground">Temporary PO:</span> <span className="font-medium">{permanentTarget.poNumber}</span></p>
          <p className="text-muted-foreground">{permanentTarget.billingPartyName} · {permanentTarget.consignee || permanentTarget.consignor}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Permanent PO Number" htmlFor="po-permanent-number" required>
            <Input id="po-permanent-number" value={permanentNumber} maxLength={100} autoFocus
              onChange={(e) => { setPermanentNumber(e.target.value.toUpperCase()); setPermanentError(""); }} />
          </FormField>
          <FormDatePicker label="Permanent PO Date" id="po-permanent-date" required value={permanentDate}
            onChange={(d) => { setPermanentDate(d); setPermanentError(""); }} />
        </div>
        <p className="text-sm text-muted-foreground">
          The new number and date will replace the temporary ones on this PO and on every LR (and its Delivery Challan) that used it.
          Bills already made are not changed.
        </p>
        {permanentError ? <p role="alert" className="text-sm text-destructive">{permanentError}</p> : null}
      </div> : null}
    </FormDialog>
  </div>;
}
