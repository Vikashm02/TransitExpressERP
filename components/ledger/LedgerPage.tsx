"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Printer, Search, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import BillingPartyLookup from "@/components/lookup/BillingPartyLookup";
import LedgerStatementView from "./LedgerStatementView";
import LedgerExportDialog from "./LedgerExportDialog";
import styles from "./LedgerStatement.module.css";

import { getLedgerStatement, type LedgerStatement } from "@/components/services/ledger.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";

/**
 * Filter-driven Billing Party statement. Combines Bills, Credit Notes,
 * and Debit Notes (via ledger.service.ts) for a selected Billing Party
 * and date range — no LR/POD operational records are shown.
 *
 * Address/Email/Contact Number are auto-filled from Billing Party
 * Master when a party is selected, but are plain local component state
 * from that point on — editing them here never calls
 * `updateBillingParty()`, so the Master is never modified from this page.
 */
export default function LedgerPage() {
  const [billingParty, setBillingParty] = useState<BillingPartyRecord | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [statement, setStatement] = useState<LedgerStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportDialog, setExportDialog] = useState<"download" | "share" | null>(null);

  function handleBillingPartySelect(record: BillingPartyRecord) {
    setBillingParty(record);
    setAddress(record.address);
    setEmail(record.email);
    setContactNumber(record.mobile);
    setStatement(null);
  }

  async function handleViewLedger() {
    if (!billingParty) {
      toast.error("Select a Billing Party first.");
      return;
    }

    if (!fromDate || !toDate) {
      toast.error("Select both From Date and To Date.");
      return;
    }

    if (fromDate > toDate) {
      toast.error("From Date cannot be after To Date.");
      return;
    }

    try {
      setLoading(true);

      const [statementData, companyData] = await Promise.all([
        getLedgerStatement(billingParty.id, fromDate, toDate),
        getCompany(),
      ]);

      setStatement(statementData);
      setCompany(companyData);
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the ledger statement.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ledger</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate a statement of account for a Billing Party over a date range.
        </p>
      </div>

      <div className="print:hidden space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <FormField
            label="Billing Party"
            htmlFor="ledger-billing-party"
            required
          >
            <div className="flex gap-3">
              <Input
                id="ledger-billing-party"
                readOnly
                placeholder="Select billing party"
                value={billingParty?.name ?? ""}
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </FormField>

          <FormDatePicker
            label="From Date"
            id="ledger-from-date"
            required
            value={fromDate}
            onChange={setFromDate}
          />

          <FormDatePicker
            label="To Date"
            id="ledger-to-date"
            required
            value={toDate}
            onChange={setToDate}
          />
        </div>

        {billingParty && (
          <div className="grid grid-cols-1 gap-5 border-t pt-5 md:grid-cols-3">
            <FormField
              label="Address"
              htmlFor="ledger-address"
              hint="Auto-filled from Billing Party Master — editable for this statement only."
            >
              <Textarea
                id="ledger-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </FormField>

            <FormField
              label="Email"
              htmlFor="ledger-email"
              hint="Auto-filled — editable for this statement only."
            >
              <Input
                id="ledger-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField
              label="Contact Number"
              htmlFor="ledger-contact"
              hint="Auto-filled — editable for this statement only."
            >
              <Input
                id="ledger-contact"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
              />
            </FormField>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleViewLedger}
            disabled={loading}
          >
            <Search className="h-3.5 w-3.5" />
            {loading ? "Loading..." : "View Ledger"}
          </Button>
        </div>
      </div>

      {statement && (
        <div>
          <div className={styles.toolbar}>
            <Button variant="outline" onClick={() => setExportDialog("download")}>
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
            <Button variant="outline" onClick={() => setExportDialog("share")}>
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
          </div>

          <LedgerStatementView
            statement={statement}
            company={company}
            address={address}
            email={email}
            contactNumber={contactNumber}
          />
        </div>
      )}

      <BillingPartyLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleBillingPartySelect}
      />

      <LedgerExportDialog
        open={exportDialog !== null}
        onOpenChange={(next) => setExportDialog(next ? exportDialog : null)}
        variant={exportDialog ?? "download"}
        statement={statement}
        company={company}
        address={address}
        email={email}
        contactNumber={contactNumber}
      />
    </div>
  );
}
