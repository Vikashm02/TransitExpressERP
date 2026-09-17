"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import BidDialog from "./BidDialog";
import BidRemindersDialog from "./BidRemindersDialog";
import BidTable from "./BidTable";
import {
  BID_HISTORY_STATUSES,
  BID_LIVE_STATUSES,
  type Bid,
} from "./bid.schema";
import {
  createBid,
  getBid,
  getBids,
  LIVE_BID_COUNT_REFRESH_EVENT,
  updateBid,
  type BidRecord,
} from "@/components/services/bid.service";
import {
  getMyScheduledReminders,
  nearestReminderByBid,
  type BidReminder,
} from "@/components/services/bidReminder.service";
import { getBillingParties, type BillingPartyRecord } from "@/components/services/billingParty.service";
import { getMaterials, type MaterialRecord } from "@/components/services/material.service";
import { VEHICLE_TYPE_OPTIONS } from "@/components/vehicle/vehicle.schema";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

type BidTab = "live" | "history";

const PAGE_SIZE = 10;

function BidListPageInner() {
  const { hasAction } = useAuth();
  const canCreate = hasAction("bids", "create");
  const canEdit = hasAction("bids", "edit");
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkBidId = searchParams.get("view");
  const liveOnly = searchParams.get("liveOnly") === "1";
  // Single-shot per deep-link target so rerenders never reopen the dialog,
  // while a later different ?view= still works without remounting.
  const handledDeepLinkRef = useRef<string | null>(null);

  const [bids, setBids] = useState<BidRecord[]>([]);
  const [reminders, setReminders] = useState<BidReminder[]>([]);
  const [billingParties, setBillingParties] = useState<BillingPartyRecord[]>([]);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<BidTab>("live");
  const [search, setSearch] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pickupFilter, setPickupFilter] = useState("");
  const [dropoffFilter, setDropoffFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBid, setEditingBid] = useState<BidRecord | null>(null);
  const [viewingBid, setViewingBid] = useState<BidRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [reminderBid, setReminderBid] = useState<BidRecord | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  // Notification deep link: /bids?view=<uuid> opens that bid's details.
  // Consumes the query via router so a later identical link works again.
  useEffect(() => {
    if (loading || !deepLinkBidId) return;
    if (handledDeepLinkRef.current === deepLinkBidId) return;
    const target = bids.find((bid) => bid.id === deepLinkBidId);
    if (!target) return;
    handledDeepLinkRef.current = deepLinkBidId;
    router.replace("/bids", { scroll: false });
    void handleView(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, bids, deepLinkBidId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [bidRows, partyRows, materialRows, reminderRows] = await Promise.all([
        getBids(),
        getBillingParties().catch(() => [] as BillingPartyRecord[]),
        getMaterials().catch(() => [] as MaterialRecord[]),
        getMyScheduledReminders().catch(() => [] as BidReminder[]),
      ]);
      setBids(bidRows);
      setBillingParties(partyRows);
      setMaterials(materialRows);
      setReminders(reminderRows);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load bids.");
    } finally {
      setLoading(false);
    }
  }

  const reminderInfo = useMemo(() => nearestReminderByBid(reminders), [reminders]);

  async function refreshReminders() {
    try {
      setReminders(await getMyScheduledReminders());
    } catch (error) {
      console.error(error);
    }
  }

  const tabStatuses = tab === "live" ? BID_LIVE_STATUSES : BID_HISTORY_STATUSES;
  const filterStatuses = liveOnly ? ["Live"] : tabStatuses;

  const filteredBids = useMemo(() => {
    const query = search.trim().toLowerCase();
    const routeQuery = `${pickupFilter.trim()} ${dropoffFilter.trim()}`.trim().toLowerCase();

    return bids.filter((bid) => {
      if (liveOnly ? bid.status !== "Live" : !tabStatuses.includes(bid.status)) return false;

      const matchesSearch =
        !query ||
        [
          bid.bidReference,
          bid.billingPartyName,
          bid.consignorName,
          bid.consigneeName,
          bid.materialName,
          bid.pickupLocation,
          bid.dropoffLocation,
        ]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

      const matchesParty = !partyFilter || String(bid.billingPartyId) === partyFilter;
      const matchesStatus = !statusFilter || bid.status === statusFilter;
      const matchesVehicle = !vehicleFilter || bid.vehicleType === vehicleFilter;
      const matchesRoute =
        !routeQuery ||
        `${bid.pickupLocation} ${bid.dropoffLocation}`.toLowerCase().includes(routeQuery);

      let matchesDate = true;
      if (tab === "history" && (fromDate || toDate)) {
        const closesAt = bid.closesAt ? new Date(bid.closesAt).getTime() : NaN;
        if (Number.isNaN(closesAt)) {
          matchesDate = !fromDate && !toDate;
        } else {
          if (fromDate && closesAt < new Date(`${fromDate}T00:00:00`).getTime()) matchesDate = false;
          if (toDate && closesAt > new Date(`${toDate}T23:59:59`).getTime()) matchesDate = false;
        }
      } else if (tab === "live" && (fromDate || toDate)) {
        const closesAt = bid.closesAt ? new Date(bid.closesAt).getTime() : NaN;
        if (!Number.isNaN(closesAt)) {
          if (fromDate && closesAt < new Date(`${fromDate}T00:00:00`).getTime()) matchesDate = false;
          if (toDate && closesAt > new Date(`${toDate}T23:59:59`).getTime()) matchesDate = false;
        }
      }

      return matchesSearch && matchesParty && matchesStatus && matchesVehicle && matchesRoute && matchesDate;
    });
  }, [bids, liveOnly, tab, tabStatuses, search, partyFilter, statusFilter, vehicleFilter, pickupFilter, dropoffFilter, fromDate, toDate]);

  function switchTab(next: BidTab) {
    if (liveOnly) router.replace("/bids", { scroll: false });
    setTab(next);
    setStatusFilter("");
  }

  function returnToNormalBidView() {
    router.replace("/bids", { scroll: false });
    setTab("live");
    setStatusFilter("");
  }

  function handleAdd() {
    setEditingBid(null);
    setViewingBid(null);
    setDialogOpen(true);
  }

  function handleEdit(bid: BidRecord) {
    setEditingBid(bid);
    setViewingBid(null);
    setDialogOpen(true);
  }

  async function handleView(bid: BidRecord) {
    // Re-read the row so details never show stale economics.
    try {
      const fresh = await getBid(bid.id);
      setEditingBid(null);
      setViewingBid(fresh);
    } catch {
      setEditingBid(null);
      setViewingBid(bid);
    }
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditingBid(null);
      setViewingBid(null);
    }
  }

  async function handleSubmit(values: Bid) {
    try {
      setSaving(true);

      if (editingBid) {
        await updateBid(editingBid.id, values);
        toast.success("Bid updated successfully.");
      } else {
        await createBid(values);
        toast.success("Bid created successfully.");
      }

      setDialogOpen(false);
      setEditingBid(null);
      await loadAll();
      window.dispatchEvent(new Event(LIVE_BID_COUNT_REFRESH_EVENT));
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "";
      toast.error(message || (editingBid ? "Unable to update bid." : "Unable to create bid."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bid Management"
        buttonText="New Bid"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="flex gap-2" role="tablist" aria-label="Bid views">
        {(["live", "history"] as BidTab[]).map((value) => (
          <Button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? "default" : "outline"}
            onClick={() => switchTab(value)}
            className={cn(tab === value && "shadow-sm")}
          >
            {value === "live" ? "Live Bids" : "Bid History"}
          </Button>
        ))}
      </div>

      {liveOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium">Showing stored Live Bids only.</p>
          <Button type="button" variant="outline" size="sm" onClick={returnToNormalBidView}>
            Show normal Bid view
          </Button>
        </div>
      )}

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder={
          tab === "live"
            ? "Search by bid ref, party, route or material..."
            : "Search by bid ref, party, route or material..."
        }
        onRefresh={loadAll}
        filters={[
          {
            key: "party",
            label: "Billing Party",
            value: partyFilter,
            options: billingParties.map((party) => ({ label: party.name, value: String(party.id) })),
            onChange: setPartyFilter,
            placeholder: "All parties",
          },
          {
            key: "status",
            label: tab === "live" ? "Status" : "Result",
            value: statusFilter,
            options: filterStatuses.map((status) => ({ label: status, value: status })),
            onChange: setStatusFilter,
            placeholder: "All statuses",
          },
          {
            key: "vehicle",
            label: "Vehicle Type",
            value: vehicleFilter,
            options: VEHICLE_TYPE_OPTIONS.map((type) => ({ label: type, value: type })),
            onChange: setVehicleFilter,
            placeholder: "All types",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Pickup contains" htmlFor="bid-filter-pickup">
          <Input
            id="bid-filter-pickup"
            placeholder="e.g. Visakhapatnam"
            value={pickupFilter}
            onChange={(e) => setPickupFilter(e.target.value)}
          />
        </FormField>
        <FormField label="Drop-off contains" htmlFor="bid-filter-dropoff">
          <Input
            id="bid-filter-dropoff"
            placeholder="e.g. Raipur"
            value={dropoffFilter}
            onChange={(e) => setDropoffFilter(e.target.value)}
          />
        </FormField>
        <FormField label={tab === "live" ? "Closing from" : "Closed from"} htmlFor="bid-filter-from">
          <Input
            id="bid-filter-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </FormField>
        <FormField label={tab === "live" ? "Closing to" : "Closed to"} htmlFor="bid-filter-to">
          <Input
            id="bid-filter-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </FormField>
      </div>

      <BidTable
        bids={filteredBids}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        canEdit={canEdit}
        reminderInfo={reminderInfo}
        onReminderClick={setReminderBid}
      />

      <BidDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        bid={editingBid ?? viewingBid}
        billingParties={billingParties}
        materials={materials}
        loading={saving}
        readOnly={Boolean(viewingBid) && !editingBid}
        onSubmit={handleSubmit}
      />

      <BidRemindersDialog
        open={reminderBid !== null}
        onOpenChange={(open) => {
          if (!open) setReminderBid(null);
        }}
        bid={reminderBid}
        onChanged={refreshReminders}
      />
    </div>
  );
}

/**
 * useSearchParams() requires a Suspense boundary, otherwise the production
 * build fails. The boundary lives here so app/bids/page.tsx stays unchanged.
 */
export default function BidListPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading bids…</div>}
    >
      <BidListPageInner />
    </Suspense>
  );
}
