"use client";

import { useMemo, useState } from "react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LRTableProps {
  lrs: any[];
  onCreate: () => void;
  onRefresh: () => void;
}

export default function LRTable({
  lrs,
  onCreate,
  onRefresh,
}: LRTableProps) {
  const [search, setSearch] = useState("");

  const filteredLR = useMemo(() => {
    return lrs.filter((lr) => {
      const text = search.toLowerCase();

      return (
        (lr.lr_number ?? "")
          .toLowerCase()
          .includes(text) ||
        (lr.consignor ?? "")
          .toLowerCase()
          .includes(text) ||
        (lr.consignee ?? "")
          .toLowerCase()
          .includes(text)
      );
    });
  }, [lrs, search]);

  return (
    <div className="space-y-6">

      <PageHeader
        title="LR Entry"
        buttonText="Create LR"
        onAdd={onCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search LR..."
        onExport={() => console.log("Export")}
        onRefresh={onRefresh}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">

          <Table>

            <TableHeader>

              <TableRow>

                <TableHead>LR No.</TableHead>

                <TableHead>Date</TableHead>

                <TableHead>Consignor</TableHead>

                <TableHead>Consignee</TableHead>

                <TableHead>Vehicle</TableHead>

                <TableHead>From</TableHead>

                <TableHead>To</TableHead>

                <TableHead>Status</TableHead>

                <TableHead className="text-right">
                  Actions
                </TableHead>

              </TableRow>

            </TableHeader>

            <TableBody>

              {filteredLR.length > 0 ? (

                filteredLR.map((lr: any) => (

                  <TableRow key={lr.id}>

                    <TableCell className="font-medium">
                      {lr.lr_number}
                    </TableCell>

                    <TableCell>
                      {lr.lr_date}
                    </TableCell>

                    <TableCell>
                      {lr.consignor}
                    </TableCell>

                    <TableCell>
                      {lr.consignee}
                    </TableCell>

                    <TableCell>
                      {lr.vehicle_number}
                    </TableCell>

                    <TableCell>
                      {lr.from_station}
                    </TableCell>

                    <TableCell>
                      {lr.to_station}
                    </TableCell>

                    <TableCell>

                      <Badge
                        className={
                          lr.status === "Delivered"
                            ? "bg-blue-600"
                            : lr.status === "Billed"
                            ? "bg-purple-600"
                            : "bg-green-600"
                        }
                      >
                        {lr.status}
                      </Badge>

                    </TableCell>

                    <TableCell>

                      <div className="flex justify-end gap-2">

                        <Button
                          size="sm"
                          variant="outline"
                        >
                          Edit
                        </Button>

                        <Button
                          size="sm"
                          variant="destructive"
                        >
                          Delete
                        </Button>

                      </div>

                    </TableCell>

                  </TableRow>

                ))

              ) : (

                <TableRow>

                  <TableCell
                    colSpan={9}
                    className="text-center py-10 text-slate-500"
                  >
                    No LR found.
                  </TableCell>

                </TableRow>

              )}

            </TableBody>

          </Table>

        </CardContent>

      </Card>

    </div>
  );
}