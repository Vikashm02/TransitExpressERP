"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStaffUsers } from "@/components/services/appUser.service";
import { createdColumns, exportCsv, staffNameResolver, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import DeliveryChallanDialog, {
  type DeliveryChallanDialogMode,
} from "./DeliveryChallanDialog";
import DeliveryChallanTable from "./DeliveryChallanTable";
import ShareDeliveryChallanDialog from "./ShareDeliveryChallanDialog";
import type { DeliveryChallan } from "./deliveryChallan.schema";

import {
  createDeliveryChallan,
  getDeliveryChallans,
  updateDeliveryChallan,
  type DeliveryChallanRecord,
  type DCChangedField,
} from "@/components/services/deliveryChallan.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import { STAFF_EDIT_WINDOW_EXPIRED_MESSAGE, canStaffEditRecord } from "@/lib/editWindow";

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const DELIVERY_CHALLAN_EXPORT_COLUMNS: ExportColumn<DeliveryChallanRecord>[] = [
  { header: "LR Number", value: (r) => r.lrNumber },
  { header: "LR Date", value: (r) => r.lrDate },
  { header: "Consignor", value: (r) => r.consignor },
  { header: "Consignor GST", value: (r) => r.consignorGst },
  { header: "Consignor Address", value: (r) => r.consignorAddress },
  { header: "By", value: (r) => r.byName },
  { header: "Consignee", value: (r) => r.consignee },
  { header: "Consignee GST", value: (r) => r.consigneeGst },
  { header: "Consignee Address", value: (r) => r.consigneeAddress },
  { header: "PO Number", value: (r) => r.poNumber },
  { header: "PO Date", value: (r) => r.poDate },
  { header: "Description", value: (r) => r.description },
  { header: "QTY (Actual Weight)", value: (r) => r.qty },
  { header: "Vehicle No", value: (r) => r.vehicleNumber },
  { header: "HSN", value: (r) => r.hsn },

];

const PAGE_SIZE = 10;

// Editable DC fields in form order for diff computation
const DC_EDITABLE_FIELDS: Array<{ key: keyof DeliveryChallan; label: string; focusKey: string }> = [
  { key: "byName", label: "By", focusKey: "by-name" },
  { key: "poNumber", label: "PO Number", focusKey: "po-number" },
  { key: "poDate", label: "PO Date", focusKey: "po-date" },
  { key: "hsn", label: "HSN", focusKey: "hsn" },
];

function normalizeString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeDate(value: unknown): string {
  if (value == null) return "";
  const str = String(value).trim();
  return str;
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function valuesEqual(a: unknown, b: unknown, type: "string" | "date" | "number"): boolean {
  switch (type) {
    case "string":
      return normalizeString(a) === normalizeString(b);
    case "date":
      return normalizeDate(a) === normalizeDate(b);
    case "number":
      return normalizeNumber(a) === normalizeNumber(b);
  }
}

function computeDCChangedFields(
  original: DeliveryChallanRecord,
  submitted: DeliveryChallan
): DCChangedField[] {
  const changed: DCChangedField[] = [];
  for (const field of DC_EDITABLE_FIELDS) {
    const originalValue = original[field.key];
    const submittedValue = submitted[field.key];
    let type: "string" | "date" | "number" = "string";
    if (field.key === "poDate") type = "date";
    if (!valuesEqual(originalValue, submittedValue, type)) {
      changed.push({ key: field.key, label: field.label, focusKey: field.focusKey });
    }
  }
  return changed;
}

export default function DeliveryChallanListPage() {
  const { hasPermission, hasAction, isAdmin } = useAuth();
  const canCreate = hasPermission("delivery_challans", "create_view");
  const canEdit =
    hasPermission("delivery_challans", "edit") || hasAction("delivery_challans", "edit");
  const canPrint = hasAction("delivery_challans", "print");
  const canShare = hasAction("delivery_challans", "share");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [challans, setChallans] = useState<DeliveryChallanRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryChallanRecord | null>(null);
  const [dialogMode, setDialogMode] = useState<DeliveryChallanDialogMode>("create");
  const [saving, setSaving] = useState(false);

  const [shareTarget, setShareTarget] = useState<DeliveryChallanRecord | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Deep-link handling for notification taps: /delivery-challans?view=<id>&focus=<focusKey>
  const deepLinkId = searchParams.get("view");
  const deepLinkFocus = searchParams.get("focus");
  const handledDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Handle a notification navigation once, then release the marker once
  // router.replace consumes its query so the same record can open again later.
  useEffect(() => {
    if (loading) return;
    if (!deepLinkId) {
      handledDeepLinkRef.current = null;
      return;
    }

    const signature = `${deepLinkId}|${deepLinkFocus ?? ""}`;
    if (handledDeepLinkRef.current === signature) return;

    const target = challans.find((c) => String(c.id) === deepLinkId);
    if (!target) return;

    handledDeepLinkRef.current = signature;
    router.replace("/delivery-challans", { scroll: false });
    handleView(target, deepLinkFocus ?? undefined);
  }, [loading, challans, deepLinkId, deepLinkFocus, router]);

  async function loadData() {
    try {
      setLoading(true);
      const data = await getDeliveryChallans();
      setChallans(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load Delivery Challans.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return challans;

    return challans.filter((row) =>
      matchesListSearch(query, [row.lrNumber, row.lrDate, row.consignor, row.consignee, row.vehicleNumber, row.qty, row.poNumber, row.hsn, row.byName])
    );
  }, [challans, search]);

  function handleAdd() {
    setEditing(null);
    setDialogMode("create");
    setDialogOpen(true);
  }

  function handleEdit(challan: DeliveryChallanRecord) {
    if (!canStaffEditRecord(isAdmin, canEdit, challan)) {
      toast.error(canEdit ? STAFF_EDIT_WINDOW_EXPIRED_MESSAGE : "You do not have permission to edit Delivery Challans.");
      return;
    }
    setEditing(challan);
    setDialogMode("edit");
    setDialogOpen(true);
  }

  function handleView(challan: DeliveryChallanRecord, focusKey?: string) {
    setEditing(challan);
    setDialogMode("view");
    // Pass focusKey via a ref or state to the dialog
    setDialogOpen(true);
    // Store focusKey for dialog to use
    if (focusKey) {
      pendingFocusKeyRef.current = focusKey;
    }
  }

  function handlePrint(challan: DeliveryChallanRecord) {
    window.open(`/delivery-challans/${challan.id}/print`, "_blank", "noopener,noreferrer");
  }

  function handleShare(challan: DeliveryChallanRecord) {
    setShareTarget(challan);
    setShareOpen(true);
  }

  const pendingFocusKeyRef = useRef<string | undefined>(undefined);

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
      setDialogMode("create");
      pendingFocusKeyRef.current = undefined;
    }
  }

  async function handleSubmit(values: DeliveryChallan) {
    try {
      setSaving(true);

      if (editing) {
        if (!canStaffEditRecord(isAdmin, canEdit, editing)) {
          toast.error(STAFF_EDIT_WINDOW_EXPIRED_MESSAGE);
          return;
        }
        const changedFields = computeDCChangedFields(editing, values);
        await updateDeliveryChallan(editing.id, values, changedFields);
        if (changedFields.length > 0) {
          toast.success("Delivery Challan updated successfully.");
        } else {
          toast.success("Delivery Challan saved (no changes detected).");
        }
      } else {
        await createDeliveryChallan(values);
        toast.success("Delivery Challan created successfully.");
      }

      setDialogOpen(false);
      setEditing(null);
      pendingFocusKeyRef.current = undefined;
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, editing ? "Unable to update Delivery Challan." : "Unable to create Delivery Challan."));
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    void (async () => {
      const staff = await getStaffUsers().catch(() => []);
      const createdBy = staffNameResolver(staff);
      exportCsv("delivery-challans", [
        ...DELIVERY_CHALLAN_EXPORT_COLUMNS,
        ...createdColumns<DeliveryChallanRecord>((r) => createdBy(r.createdBy), (r) => r.created_at),
      ], filtered);
    })();
  }


  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery Challan"
        buttonText="Create Delivery Challan"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search LR no., date, party, vehicle, qty, PO, HSN..."
        onRefresh={loadData}
        onExport={handleExport}
      />

      <DeliveryChallanTable
        challans={filtered}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        onPrint={handlePrint}
        onShare={handleShare}
        canEdit={canEdit}
        canPrint={canPrint}
        canShare={canShare}
        isAdmin={isAdmin}
      />

      <DeliveryChallanDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        mode={dialogMode}
        challan={editing}
        loading={saving}
        onSubmit={handleSubmit}
        focusKey={pendingFocusKeyRef.current}
      />

      <ShareDeliveryChallanDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        challan={shareTarget}
      />
    </div>
  );
}
