"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Column {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
}

export default function DataTable({
  columns,
  data,
}: DataTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <Table>

        <TableHeader>

          <TableRow>

            {columns.map((column) => (
              <TableHead key={column.key}>
                {column.label}
              </TableHead>
            ))}

          </TableRow>

        </TableHeader>

        <TableBody>

          {data.length === 0 ? (
            <TableRow>

              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-slate-500"
              >
                No records found.
              </TableCell>

            </TableRow>
          ) : (
            data.map((row, index) => (
              <TableRow key={index}>

                {columns.map((column) => (
                  <TableCell key={column.key}>
                    {column.render
                      ? column.render(row)
                      : row[column.key]}
                  </TableCell>
                ))}

              </TableRow>
            ))
          )}

        </TableBody>

      </Table>
    </div>
  );
}