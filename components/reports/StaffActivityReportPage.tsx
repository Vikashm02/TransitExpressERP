"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSelect from "@/components/ui/FormSelect";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";

import {
  getStaffActivityReport,
  type StaffActivityModuleKey,
  type StaffActivityReport,
  type StaffActivityRow,
} from "@/components/services/reports.service";
import { getStaffUsers, type AppUserProfile } from "@/components/services/appUser.service";

const MODULE_OPTIONS: Array<{ label: string; value: StaffActivityModuleKey }> = [
  { label: "All", value: "all" },
  { label: "LR", value: "lr" },
  { label: "POD", value: "pod" },
  { label: "Delivery Challan", value: "dc" },
  { label: "ASN", value: "asn" },
];

export default function StaffActivityReportPage() {
  const [staffUsers, setStaffUsers] = useState<AppUserProfile[]>([]);
  const [staffUserId, setStaffUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [moduleFilter, setModuleFilter] = useState<StaffActivityModuleKey>("all");

  const [report, setReport] = useState<StaffActivityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getStaffUsers()
      .then((users) => {
        if (cancelled) return;
        setStaffUsers(users);
        if (users.length > 0) {
          setStaffUserId(users[0].id);
        }
      })
      .catch((error) => {
        console.error(error);
        toast.error("Unable to load staff members.");
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRun() {
    if (!staffUserId) {
      toast.error("Select a staff member.");
      return;
    }

    try {
      setLoading(true);
      const reportData = await getStaffActivityReport({
        staffUserId,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        module: moduleFilter,
      });
      setReport(reportData);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load the Staff Operations Activity report.");
    } finally {
      setLoading(false);
    }
  }

  const selectedStaff = staffUsers.find((user) => user.id === staffUserId);
  const staffLabel = selectedStaff
    ? `${selectedStaff.displayName} (${selectedStaff.email})`
    : "—";

  const columns: DataTableColumn<StaffActivityRow>[] = [
    { key: "module", header: "Module", sortable: true, className: "font-medium" },
    {
      key: "createdCount",
      header: "Created",
      align: "right",
      sortable: true,
      render: (row) => row.createdCount.toLocaleString(),
    },
    {
      key: "editedCount",
      header: "Edited",
      align: "right",
      sortable: true,
      render: (row) => row.editedCount.toLocaleString(),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Operations Activity"
        buttonText=""
        showAddButton={false}
        subtitle="Counts of Operations records created or edited by a staff member in a date range."
      />

      <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <FormSelect
          label="Staff Member"
          id="staff-activity-user"
          required
          value={staffUserId}
          onValueChange={setStaffUserId}
          disabled={usersLoading || staffUsers.length === 0}
          placeholder={usersLoading ? "Loading…" : "Select staff"}
          options={staffUsers.map((user) => ({
            label: `${user.displayName} (${user.role})`,
            value: user.id,
          }))}
        />

        <FormDatePicker
          label="From Date"
          id="staff-activity-from"
          value={fromDate}
          onChange={setFromDate}
        />

        <FormDatePicker
          label="To Date"
          id="staff-activity-to"
          value={toDate}
          onChange={setToDate}
        />

        <FormSelect
          label="Module"
          id="staff-activity-module"
          value={moduleFilter}
          onValueChange={(value) => setModuleFilter(value as StaffActivityModuleKey)}
          options={MODULE_OPTIONS}
        />

        <div className="flex items-end">
          <Button
            className="w-full"
            onClick={handleRun}
            disabled={loading || !staffUserId}
          >
            {loading ? "Running…" : "Run Report"}
          </Button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              icon={Activity}
              title="Total Created"
              value={report.totalCreated}
            />
            <StatCard
              icon={Activity}
              title="Total Edited"
              value={report.totalEdited}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Staff: {staffLabel}
            {report.fromDate || report.toDate
              ? ` · ${report.fromDate || "Start"} → ${report.toDate || "Today"}`
              : " · All time"}
          </p>

          <DataTable
            columns={columns}
            data={report.rows}
            rowKey={(row) => row.moduleKey}
            loading={loading}
            emptyTitle="No activity"
            emptyDescription="No matching Operations records for these filters."
            sortable
            defaultSort={{ key: "module", direction: "asc" }}
          />
        </>
      )}
    </div>
  );
}
