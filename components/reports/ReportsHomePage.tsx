"use client";

import Link from "next/link";
import {
  Activity,
  FileText,
  IndianRupee,
  Package,
  Users,
  type LucideIcon,
} from "lucide-react";

interface ReportLink {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const OPERATIONAL_REPORTS: ReportLink[] = [
  {
    title: "LR Summary by Billing Party",
    description: "Total, Billed, and Unbilled LRs for every Billing Party.",
    href: "/reports/lr-summary",
    icon: FileText,
  },
  {
    title: "Outstanding Payment by Billing Party",
    description:
      "Aging (0-30 / 31-60 / 60+ days) outstanding balance and overdue amount per Billing Party.",
    href: "/reports/outstanding-payment",
    icon: IndianRupee,
  },
  {
    title: "Billing Summary",
    description:
      "Number of Bills, Total Billing Amount, Amount Received, and Outstanding for every Billing Party.",
    href: "/reports/billing-summary",
    icon: IndianRupee,
  },
  {
    title: "Staff Operations Activity",
    description:
      "Counts of LR, POD, Delivery Challan, and ASN records created or edited by a staff member.",
    href: "/reports/staff-activity",
    icon: Activity,
  },
];

const SUPPLY_INTELLIGENCE_REPORTS: ReportLink[] = [
  {
    title: "Consignee Supply",
    description:
      "Who receives material, weight share, material mix, and preference trends by consignee.",
    href: "/reports/supply-intelligence/consignee",
    icon: Users,
  },
  {
    title: "Material Supply",
    description:
      "Which materials move most, consignee distribution, concentration, and monthly growth.",
    href: "/reports/supply-intelligence/material",
    icon: Package,
  },
];

function ReportCardGrid({ reports }: { reports: ReportLink[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {reports.map((report) => {
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
              <p className="mt-1 text-sm text-muted-foreground">
                {report.description}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Deliberately a simple report-selection screen, not a dashboard —
 * per the approved scope, Reports is "professional but simple", read
 * only, and only ever navigates into one of the report pages below.
 */
export default function ReportsHomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only reports for Admin/Accounts. View on screen, or download/share
          as PDF or Excel.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            Supply Intelligence
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Material supply analytics from LR history — weight, mix, consignees,
            and trends for planning.
          </p>
        </div>
        <ReportCardGrid reports={SUPPLY_INTELLIGENCE_REPORTS} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            Operational reports
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Billing, outstanding, LR summary, and staff activity.
          </p>
        </div>
        <ReportCardGrid reports={OPERATIONAL_REPORTS} />
      </section>
    </div>
  );
}
