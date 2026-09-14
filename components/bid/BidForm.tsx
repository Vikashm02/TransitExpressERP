"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { CustomerRecord } from "@/components/services/customer.service";
import type { MaterialRecord } from "@/components/services/material.service";
import MasterAutocomplete, { type MasterAutocompleteOption } from "@/components/lookup/MasterAutocomplete";
import { VEHICLE_TYPE_OPTIONS } from "@/components/vehicle/vehicle.schema";
import {
  calculateBidProfitability,
  equivalentWinningRatePerMT,
  formatINR,
  formatMT,
  formatPercent,
  type BidRateBasis,
} from "@/lib/calculations/bidCalculations";
import {
  BID_LOSS_REASON_OPTIONS,
  BID_RATE_BASIS_OPTIONS,
  BID_SOURCE_OPTIONS,
  BID_STATUS_OPTIONS,
  type Bid,
} from "./bid.schema";
import type { FieldErrors } from "@/lib/validation";

interface BidFormProps {
  bid: Bid;
  errors?: FieldErrors<Bid>;
  onChange: (bid: Bid) => void;
  billingParties: BillingPartyRecord[];
  customers: CustomerRecord[];
  materials: MaterialRecord[];
  isNew?: boolean;
  /** View-only mode disables the whole form via fieldset. */
  readOnly?: boolean;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
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

function ProfitRow({ label, value, isLoss }: { label: string; value: string; isLoss?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${isLoss ? "text-destructive" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

export default function BidForm({ bid, errors = {}, onChange, billingParties, customers, materials, readOnly = false }: BidFormProps) {
  function update<K extends keyof Bid>(key: K, value: Bid[K]) {
    onChange({ ...bid, [key]: value });
  }

  function partyName(parties: BillingPartyRecord[], id: number): string {
    return parties.find((row) => row.id === id)?.name ?? "";
  }

  function customerName(id: number): string {
    return customers.find((row) => row.id === id)?.name ?? "";
  }

  function handlePartySelect(option: MasterAutocompleteOption) {
    const party = billingParties.find((row) => row.id === option.id);
    if (party) update("billingPartyId", party.id);
  }

  /** Mirror the LR consignor/consignee convention: selecting a party
   * suggests its city into the matching location field, but only when
   * that field is still empty. Distance stays manual — never auto-set. */
  function handleConsignorChange(id: number) {
    const customer = customers.find((row) => row.id === id);
    const next = { ...bid, consignorId: id };
    if (customer && !next.pickupLocation.trim() && customer.city.trim()) {
      next.pickupLocation = customer.city.trim();
    }
    onChange(next);
  }

  function handleConsigneeChange(id: number) {
    const customer = customers.find((row) => row.id === id);
    const next = { ...bid, consigneeId: id };
    if (customer && !next.dropoffLocation.trim() && customer.city.trim()) {
      next.dropoffLocation = customer.city.trim();
    }
    onChange(next);
  }

  const calc = calculateBidProfitability({
    marketVehicleQuote: bid.marketVehicleQuote,
    expectedLoadMT: bid.expectedLoadMT,
    bidRate: bid.bidRate,
    bidRateBasis: bid.bidRateBasis,
    totalQuantityMT: bid.totalQuantityMT,
  });
  const isLoss = calc.grossProfitPerVehicle !== null && calc.grossProfitPerVehicle < 0;
  const winningEquiv =
    bid.winningRate !== null &&
    bid.winningRate !== undefined &&
    bid.winningRateBasis
      ? equivalentWinningRatePerMT(bid.winningRate, bid.winningRateBasis as BidRateBasis, bid.expectedLoadMT)
      : null;
  const isClosed = bid.status === "Won" || bid.status === "Lost" || bid.status === "Cancelled";

  return (
    <fieldset disabled={readOnly} className="space-y-6">
      <FormSection title="Basic Bid Details">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Bid Reference" htmlFor="bid-reference" error={errors.bidReference} hint="External bid ID, if any. Optional.">
            <Input
              id="bid-reference"
              placeholder="e.g. CX-2026-1841 (optional)"
              value={bid.bidReference}
              onChange={(e) => update("bidReference", e.target.value)}
            />
          </FormField>
          <FormField
            label="Bid Hosted By / Billing Party"
            htmlFor="bid-billing-party"
            required
            error={errors.billingPartyId}
            hint="Type to search Billing Party Master, then select a row. Free text is not allowed."
          >
            <MasterAutocomplete
              id="bid-billing-party"
              value={partyName(billingParties, bid.billingPartyId)}
              options={billingParties.map((party) => ({
                id: party.id,
                label: party.name,
                description: party.code,
                keywords: `${party.code} ${party.city} ${party.gst}`,
              }))}
              onSelect={handlePartySelect}
              onClear={() => update("billingPartyId", 0)}
              placeholder="Type to find billing party..."
              emptyMessage="No matching billing party in master data."
            />
          </FormField>
          <FormField label="Source" htmlFor="bid-source" required error={errors.source}>
            <FormSelect
              id="bid-source"
              value={bid.source}
              onValueChange={(value) => update("source", value as Bid["source"])}
              options={toOptions(BID_SOURCE_OPTIONS)}
              placeholder="Select Source"
            />
          </FormField>
          <FormField label="Status" htmlFor="bid-status" required error={errors.status}>
            <FormSelect
              id="bid-status"
              value={bid.status}
              onValueChange={(value) => update("status", value as Bid["status"])}
              options={toOptions(BID_STATUS_OPTIONS)}
              placeholder="Select Status"
            />
          </FormField>
          <FormField label="Posted / Open Date & Time" htmlFor="bid-posted-at" error={errors.postedAt}>
            <Input
              id="bid-posted-at"
              type="datetime-local"
              value={toDateTimeLocal(bid.postedAt)}
              onChange={(e) => update("postedAt", fromDateTimeLocal(e.target.value))}
            />
          </FormField>
          <FormField
            label="Bid Closing Date & Time"
            htmlFor="bid-closes-at"
            error={errors.closesAt}
            hint="Optional — a Live bid may have an unknown closing time."
          >
            <Input
              id="bid-closes-at"
              type="datetime-local"
              value={toDateTimeLocal(bid.closesAt)}
              onChange={(e) => update("closesAt", fromDateTimeLocal(e.target.value))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Notes / Remarks" htmlFor="bid-notes" error={errors.notes}>
              <Textarea
                id="bid-notes"
                placeholder="Internal notes about this bid"
                value={bid.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </FormField>
          </div>
        </div>
      </FormSection>

      <FormSection title="Route — Consignor → Consignee">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Consignor (Pickup Party)"
            htmlFor="bid-consignor"
            error={errors.consignorId}
            hint="Type to search Customer Master, then select a row. Free text is not allowed."
          >
            <MasterAutocomplete
              id="bid-consignor"
              value={customerName(bid.consignorId)}
              options={customers.map((customer) => ({
                id: customer.id,
                label: customer.name,
                description: customer.code,
                keywords: `${customer.code} ${customer.gst} ${customer.city} ${customer.address}`,
              }))}
              onSelect={(option) => {
                const customer = customers.find((row) => row.id === option.id);
                if (customer) handleConsignorChange(customer.id);
              }}
              onClear={() => handleConsignorChange(0)}
              placeholder="Type to find consignor..."
              emptyMessage="No matching customer in master data."
            />
          </FormField>
          <FormField label="Pickup Location" htmlFor="bid-pickup" required error={errors.pickupLocation}>
            <Input
              id="bid-pickup"
              placeholder="e.g. Visakhapatnam"
              value={bid.pickupLocation}
              onChange={(e) => update("pickupLocation", e.target.value)}
            />
          </FormField>
          <FormField
            label="Consignee (Delivery Party)"
            htmlFor="bid-consignee"
            error={errors.consigneeId}
            hint="Type to search Customer Master, then select a row. Free text is not allowed."
          >
            <MasterAutocomplete
              id="bid-consignee"
              value={customerName(bid.consigneeId)}
              options={customers.map((customer) => ({
                id: customer.id,
                label: customer.name,
                description: customer.code,
                keywords: `${customer.code} ${customer.gst} ${customer.city} ${customer.address}`,
              }))}
              onSelect={(option) => {
                const customer = customers.find((row) => row.id === option.id);
                if (customer) handleConsigneeChange(customer.id);
              }}
              onClear={() => handleConsigneeChange(0)}
              placeholder="Type to find consignee..."
              emptyMessage="No matching customer in master data."
            />
          </FormField>
          <FormField label="Drop-off Location" htmlFor="bid-dropoff" required error={errors.dropoffLocation}>
            <Input
              id="bid-dropoff"
              placeholder="e.g. Raipur"
              value={bid.dropoffLocation}
              onChange={(e) => update("dropoffLocation", e.target.value)}
            />
          </FormField>
          <FormField label="Distance (KM)" htmlFor="bid-distance" error={errors.distanceKm}>
            <BlankableNumberInput
              id="bid-distance"
              min={0}
              value={bid.distanceKm}
              onChange={(value) => update("distanceKm", value)}
            />
          </FormField>
          <FormField label="Transit Time" htmlFor="bid-transit-time" error={errors.transitTime} hint="Optional free text.">
            <Input
              id="bid-transit-time"
              placeholder="e.g. 2 days"
              value={bid.transitTime}
              onChange={(e) => update("transitTime", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Load & Commercial">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField
              label="Material Description"
              htmlFor="bid-material-description"
              error={errors.materialDescription}
              hint="Free text exactly as written on the tender document. Not linked to Material Master."
            >
              <Textarea
                id="bid-material-description"
                placeholder='e.g. UN-SHREDDED RDF FROM MSW AS PER TENDER'
                value={bid.materialDescription}
                onChange={(e) => update("materialDescription", e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Material" htmlFor="bid-material" error={errors.materialId}>
            <FormSelect
              id="bid-material"
              value={bid.materialId > 0 ? String(bid.materialId) : ""}
              onValueChange={(value) => update("materialId", Number(value) || 0)}
              options={materials.map((material) => ({
                label: `${material.materialName} (${material.code})`,
                value: String(material.id),
              }))}
              placeholder="Select from Material Master"
            />
          </FormField>
          <FormField label="Vehicle Type" htmlFor="bid-vehicle-type" error={errors.vehicleType}>
            <FormSelect
              id="bid-vehicle-type"
              value={bid.vehicleType}
              onValueChange={(value) => update("vehicleType", value)}
              options={toOptions(VEHICLE_TYPE_OPTIONS)}
              placeholder="Select Vehicle Type"
            />
          </FormField>
          <FormField label="Total Bid Quantity (MT)" htmlFor="bid-total-qty" error={errors.totalQuantityMT}>
            <BlankableNumberInput
              id="bid-total-qty"
              min={0}
              value={bid.totalQuantityMT}
              onChange={(value) => update("totalQuantityMT", value)}
            />
          </FormField>
          <FormField label="Expected Load Per Vehicle (MT)" htmlFor="bid-expected-load" error={errors.expectedLoadMT}>
            <BlankableNumberInput
              id="bid-expected-load"
              min={0}
              value={bid.expectedLoadMT}
              onChange={(value) => update("expectedLoadMT", value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Market Vehicle Cost">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Market Vehicle Quote (₹ / vehicle)" htmlFor="bid-market-quote" error={errors.marketVehicleQuote}>
            <BlankableNumberInput
              id="bid-market-quote"
              min={0}
              value={bid.marketVehicleQuote}
              onChange={(value) => update("marketVehicleQuote", value)}
            />
          </FormField>
          <FormField label="Market Cost Per MT">
            <div className="rounded-lg border border-border/60 bg-surface-muted/60 px-3 py-2 text-sm font-semibold">
              {formatINR(calc.marketCostPerMT)} / MT
            </div>
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Our Bid">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Bid Rate Basis" htmlFor="bid-rate-basis" error={errors.bidRateBasis}>
            <FormSelect
              id="bid-rate-basis"
              value={bid.bidRateBasis ?? ""}
              onValueChange={(value) => update("bidRateBasis", (value || null) as Bid["bidRateBasis"])}
              options={toOptions(BID_RATE_BASIS_OPTIONS)}
              placeholder="Select Basis"
            />
          </FormField>
          <FormField label="Our Bid Rate" htmlFor="bid-rate" error={errors.bidRate}>
            <BlankableNumberInput
              id="bid-rate"
              min={0}
              value={bid.bidRate}
              onChange={(value) => update("bidRate", value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Profitability Calculator">
        <ProfitRow label="Market Vehicle Quote" value={bid.marketVehicleQuote > 0 ? formatINR(bid.marketVehicleQuote) : "—"} />
        <ProfitRow label="Market Cost / Vehicle" value={bid.marketVehicleQuote > 0 ? formatINR(bid.marketVehicleQuote) : "—"} />
        <ProfitRow
          label="Expected Load / Vehicle"
          value={bid.expectedLoadMT > 0 ? formatMT(bid.expectedLoadMT) : "—"}
        />
        <ProfitRow label="Market Cost / MT" value={`${formatINR(calc.marketCostPerMT)} / MT`} />
        <ProfitRow
          label="Our Bid Rate"
          value={
            bid.bidRate > 0 && bid.bidRateBasis
              ? `${formatINR(bid.bidRate)} ${bid.bidRateBasis === "Per MT" ? "/ MT" : "/ vehicle"}`
              : "—"
          }
        />
        <ProfitRow label="Equivalent Bid Rate / MT" value={`${formatINR(calc.equivalentRatePerMT)} / MT`} />
        <ProfitRow label="Revenue / Vehicle" value={formatINR(calc.revenuePerVehicle)} />
        <ProfitRow label="Expected Profit / Vehicle" value={formatINR(calc.grossProfitPerVehicle)} isLoss={isLoss} />
        <ProfitRow label="Expected Profit / MT" value={`${formatINR(calc.profitPerMT)} / MT`} isLoss={isLoss} />
        <ProfitRow label="Margin %" value={formatPercent(calc.marginPercent)} isLoss={isLoss} />
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Project estimates
          </p>
          <ProfitRow label="Total Bid Quantity" value={formatMT(bid.totalQuantityMT)} />
          <ProfitRow label="Estimated Loads" value={calc.totals.estimatedLoadsRaw === null ? "—" : calc.totals.estimatedLoadsRaw.toLocaleString("en-IN", { maximumFractionDigits: 1 })} />
          <ProfitRow label="Approx. Vehicles Required" value={calc.totals.estimatedWholeVehicles === null ? "—" : String(calc.totals.estimatedWholeVehicles)} />
          <ProfitRow label="Estimated Total Revenue" value={formatINR(calc.totals.estimatedTotalRevenue)} />
          <ProfitRow label="Estimated Total Market Cost" value={formatINR(calc.totals.estimatedTotalMarketCost)} />
          <ProfitRow
            label="Estimated Total Gross Profit"
            value={formatINR(calc.totals.estimatedTotalGrossProfit)}
            isLoss={(calc.totals.estimatedTotalGrossProfit ?? 0) < 0}
          />
        </div>
      </FormSection>

      <FormSection title="Result / Closure">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Winning / Closing Rate" htmlFor="bid-winning-rate" error={errors.winningRate}>
            <BlankableNumberInput
              id="bid-winning-rate"
              min={0}
              value={bid.winningRate ?? 0}
              onChange={(value) => update("winningRate", value === 0 ? null : value)}
            />
          </FormField>
          <FormField label="Winning Rate Basis" htmlFor="bid-winning-basis" error={errors.winningRateBasis} hint="Required whenever a winning rate is entered.">
            <FormSelect
              id="bid-winning-basis"
              value={bid.winningRateBasis ?? ""}
              onValueChange={(value) =>
                update("winningRateBasis", (value || null) as Bid["winningRateBasis"])
              }
              options={toOptions(BID_RATE_BASIS_OPTIONS)}
              placeholder="Select Basis"
            />
          </FormField>
          {winningEquiv !== null && (
            <div className="sm:col-span-2">
              <FormField label="Equivalent Winning ₹ / MT">
                <div className="rounded-lg border border-border/60 bg-surface-muted/60 px-3 py-2 text-sm font-semibold">
                  {formatINR(winningEquiv)} / MT
                </div>
              </FormField>
            </div>
          )}
          <FormField label="Loss Reason" htmlFor="bid-loss-reason" error={errors.lossReason}>
            <FormSelect
              id="bid-loss-reason"
              value={bid.lossReason ?? ""}
              onValueChange={(value) => update("lossReason", (value || null) as Bid["lossReason"])}
              options={[{ label: "—", value: "" }, ...toOptions(BID_LOSS_REASON_OPTIONS)]}
              placeholder="Select Reason"
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Result Remarks" htmlFor="bid-result-remarks" error={errors.resultRemarks}>
              <Textarea
                id="bid-result-remarks"
                placeholder={isClosed ? "Closure details" : "Available when closing the bid"}
                value={bid.resultRemarks}
                onChange={(e) => update("resultRemarks", e.target.value)}
              />
            </FormField>
          </div>
        </div>
      </FormSection>
    </fieldset>
  );
}
