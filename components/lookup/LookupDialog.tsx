"use client";

import FormDialog from "@/components/ui/FormDialog";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";

interface LookupDialogProps<T> {
  open: boolean;
  title: string;

  search: string;
  onSearchChange: (value: string) => void;

  data: T[];
  loading?: boolean;

  columns: {
    key: keyof T;
    label: string;
  }[];

  onSelect: (item: T) => void;

  onClose: () => void;
}

/**
 * Generic master-data lookup, built on the shared `FormDialog` + `DataTable`
 * framework instead of a bespoke `Dialog` + raw `<table>`. Carries no
 * domain-specific logic — callers (CustomerLookup, VehicleLookup, etc.)
 * own the data source, search filtering, and column definitions.
 */
export default function LookupDialog<T extends Record<string, any>>({
  open,
  title,
  search,
  onSearchChange,
  data,
  loading = false,
  columns,
  onSelect,
  onClose,
}: LookupDialogProps<T>) {
  const tableColumns: DataTableColumn<T>[] = columns.map((column) => ({
    key: String(column.key),
    header: column.label,
    render: (row) => String(row[column.key] ?? ""),
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      size="lg"
    >
      <DataTable
        columns={tableColumns}
        data={data}
        loading={loading}
        rowKey={(row, index) => (row.id as string | number | undefined) ?? index}
        searchable
        searchValue={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search..."
        emptyTitle="No records found"
        actions={[
          {
            label: "Select",
            onClick: onSelect,
          },
        ]}
      />
    </FormDialog>
  );
}
