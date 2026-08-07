"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LookupDialogProps<T> {
  open: boolean;
  title: string;

  search: string;
  onSearchChange: (value: string) => void;

  data: T[];

  columns: {
    key: keyof T;
    label: string;
  }[];

  onSelect: (item: T) => void;

  onClose: () => void;
}

export default function LookupDialog<T extends Record<string, any>>({
  open,
  title,
  search,
  onSearchChange,
  data,
  columns,
  onSelect,
  onClose,
}: LookupDialogProps<T>) {
  return (
    <Dialog open={open} onOpenChange={onClose}>

      <DialogContent className="max-w-4xl">

        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) =>
            onSearchChange(e.target.value)
          }
        />

        <div className="border rounded-lg overflow-hidden mt-4">

          <table className="w-full">

            <thead className="bg-slate-100">

              <tr>

                {columns.map((column) => (

                  <th
                    key={String(column.key)}
                    className="text-left px-4 py-3"
                  >
                    {column.label}
                  </th>

                ))}

                <th className="w-28"></th>

              </tr>

            </thead>

            <tbody>

              {data.map((item, index) => (

                <tr
                  key={index}
                  className="border-t"
                >

                  {columns.map((column) => (

                    <td
                      key={String(column.key)}
                      className="px-4 py-3"
                    >
                      {String(item[column.key])}
                    </td>

                  ))}

                  <td className="px-4 py-3 text-right">

                    <Button
                      size="sm"
                      onClick={() => onSelect(item)}
                    >
                      Select
                    </Button>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </DialogContent>

    </Dialog>
  );
}