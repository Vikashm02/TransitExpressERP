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
 * Generic master-data lookup. Entire rows are clickable for selection
 * (desktop + mobile). A Select action remains as a keyboard-friendly
 * secondary control.
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

  function selectAndClose(item: T) {
    onSelect(item);
    onClose();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description="Click a row to select. Type to filter results."
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
        searchPlaceholder="Type to search..."
        emptyTitle="No matching records"
        emptyDescription="Try a different search, or add the record in Master data first."
        onRowClick={selectAndClose}
        actions={[
          {
            label: "Select",
            onClick: selectAndClose,
          },
        ]}
      />
    </FormDialog>
  );
}
