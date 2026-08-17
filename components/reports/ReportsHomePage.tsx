"use client";

import Link from "next/link";
import { Activity, FileText, IndianRupee, type LucideIcon } from "lucide-react";

interface ReportLink {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const REPORTS: ReportLink[] = [
  {
    title: "LR Summary by Billing Party",
    description: "Total, Billed, and Unbilled LRs for every Billing Party.",
    href: "/reports/lr-summary",
    icon: FileText,
  },
  {
    title: "Outstanding Payment by Billing Party",
    description: "Aging (0-30 / 31-60 / 60+ days) outstanding balance and overdue amount per Billing Party.",
    href: "/reports/outstanding-payment",
    icon: IndianRupee,
  },
  {
    title: "Billing Summary",
    description: "Number of Bills, Total Billing Amount, Amount Received, and Outstanding for every Billing Party.",
    href: "/reports/billing-summary",
    icon: IndianRupee,
  },
  {
    title: "Staff Operations Activity",
    description: "Counts of LR, POD, Delivery Challan, and ASN records created or edited by a staff member.",
    href: "/reports/staff-activity",
    icon: Activity,
  },
];

/**
 * Deliberately a simple report-selection screen, not a dashboard —
 * per the approved scope, Reports is "professional but simple", read
 * only, and only ever navigates into one of the report pages below.
 */
export default function ReportsHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only reports for Admin/Accounts. View on screen, or download/share as PDF or Excel.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REPORTS.map((report) => {
          const Icon = report.icon;

          return (
            <Link
              key={report.href}
              href={report.href}
              className="flex items-start gap-4 rounded-xl border bg-card p-6 shadow-sm transition-colors hover:bg-accent"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>

              <div className="min-w-0">
                <p className="font-semibold text-foreground">{report.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
