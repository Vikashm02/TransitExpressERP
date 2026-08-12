"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import DeliveryChallanDialog, {
  type DeliveryChallanDialogMode,
} from "./DeliveryChallanDialog";
import DeliveryChallanTable from "./DeliveryChallanTable";
import type { DeliveryChallan } from "./deliveryChallan.schema";

import {
  createDeliveryChallan,
  getDeliveryChallans,
  updateDeliveryChallan,
  type DeliveryChallanRecord,
} from "@/components/services/deliveryChallan.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function DeliveryChallanListPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("delivery_challans", "create_view");
  const canEdit = hasPermission("delivery_challans", "edit");

  const [challans, setChallans] = useState<DeliveryChallanRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryChallanRecord | null>(null);
  const [dialogMode, setDialogMode] = useState<DeliveryChallanDialogMode>("create");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

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
      [
        row.lrNumber,
        row.consignor,
        row.consignee,
        row.vehicleNumber,
        row.poNumber,
        row.hsn,
        row.byName,
      ]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query))
    );
  }, [challans, search]);

  function handleAdd() {
    setEditing(null);
    setDialogMode("create");
    setDialogOpen(true);
  }

  function handleEdit(challan: DeliveryChallanRecord) {
    setEditing(challan);
    setDialogMode("edit");
    setDialogOpen(true);
  }

  function handleView(challan: DeliveryChallanRecord) {
    setEditing(challan);
    setDialogMode("view");
    setDialogOpen(true);
  }

  function handlePrint(challan: DeliveryChallanRecord) {
    window.open(`/delivery-challans/${challan.id}/print`, "_blank", "noopener,noreferrer");
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
      setDialogMode("create");
    }
  }

  async function handleSubmit(values: DeliveryChallan) {
    try {
      setSaving(true);

      if (editing) {
        await updateDeliveryChallan(editing.id, values);
        toast.success("Delivery Challan updated successfully.");
      } else {
        await createDeliveryChallan(values);
        toast.success("Delivery Challan created successfully.");
      }

      setDialogOpen(false);
      setEditing(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(
        editing ? "Unable to update Delivery Challan." : "Unable to create Delivery Challan."
      );
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = [
      "LR Number",
      "LR Date",
      "Dispatch From",
      "Dispatch To",
      "By",
      "Vehicle No",
      "QTY",
      "PO No",
      "PO Date",
      "HSN",
      "Description",
    ];

    const rows = filtered.map((row) => [
      row.lrNumber,
      row.lrDate,
      row.consignor,
      row.consignee,
      row.byName,
      row.vehicleNumber,
      Number(row.qty).toFixed(3),
      row.poNumber,
      row.poDate,
      row.hsn,
      row.description,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "delivery-challans.csv";
    link.click();
    URL.revokeObjectURL(url);
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
        placeholder="Search by LR, party, vehicle, PO, HSN..."
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
        canEdit={canEdit}
      />

      <DeliveryChallanDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        mode={dialogMode}
        challan={editing}
        loading={saving}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
