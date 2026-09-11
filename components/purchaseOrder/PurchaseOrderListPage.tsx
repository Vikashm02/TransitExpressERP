"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
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
import { getPurchaseOrders, getPurchaseOrderParties, savePurchaseOrder,
  type PurchaseOrderRecord, type PurchaseOrderParty } from "@/components/services/purchaseOrder.service";

const empty: PurchaseOrder = { billingPartyId: 0, poNumber: "", issueDate: "", allottedWeight: 0, status: "Active" };
const weight = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export default function PurchaseOrderListPage() {
  const { hasAction } = useAuth();
  const [rows, setRows] = useState<PurchaseOrderRecord[]>([]);
  const [parties, setParties] = useState<PurchaseOrderParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
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
    getPurchaseOrders().then((data) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function showForm(record: PurchaseOrderRecord | null) {
    try {
      setParties(await getPurchaseOrderParties());
      setEditing(record);
      setValues(record ? {
        billingPartyId: record.billingPartyId, poNumber: record.poNumber,
        issueDate: record.issueDate, allottedWeight: record.allottedWeight, status: record.status,
      } : { ...empty });
      setErrors({});
      setOpen(true);
    } catch { toast.error("Unable to load billing parties for PO entry."); }
  }

  async function save() {
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
        : "Unable to save PO. Check your permissions; the party and number of a linked PO cannot be changed.");
    } finally { setSaving(false); }
  }

  const filtered = rows.filter((r) => (!status || r.status === status)
    && `${r.poNumber} ${r.billingPartyName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns: DataTableColumn<PurchaseOrderRecord>[] = [
    { key: "poNumber", header: "PO Number", sortable: true },
    { key: "billingPartyName", header: "Billing Party", sortable: true },
    { key: "issueDate", header: "Issue Date", sortable: true },
    { key: "allottedWeight", header: "Allotted (MT)", render: (r) => weight(r.allottedWeight), sortable: true },
    { key: "usedWeight", header: "Used (MT)", render: (r) => weight(r.usedWeight), sortable: true },
    { key: "remaining", header: "Remaining / Excess (MT)", render: (r) => {
      const u = purchaseOrderUsage(r.allottedWeight, r.usedWeight);
      return u.exceeded > 0 ? `${weight(u.exceeded)} over allotted` : weight(u.remaining);
    } },
    { key: "usage", header: "Usage", render: (r) => {
      const u = purchaseOrderUsage(r.allottedWeight, r.usedWeight);
      return `${u.percent.toFixed(1)}%${u.warning === "red" ? " · High usage" : u.warning === "yellow" ? " · Near limit" : ""}`;
    } },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

  return <div className="space-y-6">
    <PageHeader title="PO Master" buttonText="Add PO" showAddButton={canCreate}
      onAdd={() => void showForm(null)}
      subtitle="Loading weight from final, non-cancelled LRs. Active / Inactive is always set manually." />
    <p className="text-sm text-muted-foreground">Yellow: 80–90% used. Red: above 90%. Exceeding the allotted weight does not close the PO.</p>
    <SearchToolbar search={search} onSearchChange={setSearch} placeholder="Search PO number or billing party..."
      onRefresh={refresh} filters={[{ key: "status", label: "Status", value: status, placeholder: "All statuses",
        options: ["Active", "Inactive"].map((s) => ({ label: s, value: s })), onChange: setStatus }]} />
    {loadError ? <p role="alert" className="text-sm text-destructive">Unable to load PO data. Refresh or contact your administrator; displayed data may be outdated.</p> : null}
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} loading={loading} pageSize={10}
      emptyTitle="No purchase orders found" sortable
      getRowClassName={(r) => purchaseOrderWarningClass(r.allottedWeight, r.usedWeight)}
      actions={canEdit ? [{ label: "Edit", icon: Pencil, onClick: (r) => void showForm(r), variant: "outline" }] : []} />
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
        <FormField label="PO Number" htmlFor="po-number" required error={errors.poNumber}>
          <Input id="po-number" value={values.poNumber} maxLength={100}
            onChange={(e) => setValues({ ...values, poNumber: e.target.value.toUpperCase() })} />
        </FormField>
        <FormDatePicker label="Issue Date" id="po-date" required error={errors.issueDate}
          value={values.issueDate} onChange={(issueDate) => setValues({ ...values, issueDate })} />
        <FormField label="Allotted Weight (MT)" htmlFor="po-weight" required error={errors.allottedWeight}>
          <Input id="po-weight" type="number" min="0" step="any" value={values.allottedWeight || ""}
            onChange={(e) => setValues({ ...values, allottedWeight: Number(e.target.value) })} />
        </FormField>
        <FormSelect label="Status" id="po-status" value={values.status}
          options={["Active", "Inactive"].map((s) => ({ label: s, value: s }))}
          onValueChange={(s) => setValues({ ...values, status: s as PurchaseOrder["status"] })} />
      </div>
    </FormDialog>
  </div>;
}
