"use client";

import { useState } from "react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import DriverDialog from "./DriverDialog";

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

const drivers = [
  {
    driverName: "Ramesh Patil",
    mobile: "9876543210",
    licenseNumber: "MH14202312345",
    licenseExpiry: "2028-12-31",
    address: "Pune",
    status: "Active",
  },
  {
    driverName: "Suresh Shah",
    mobile: "9822001122",
    licenseNumber: "MH14202254321",
    licenseExpiry: "2027-05-20",
    address: "Mumbai",
    status: "Active",
  },
];

export default function DriverTable() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filteredDrivers = drivers.filter(
    (driver) =>
      driver.driverName
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      driver.licenseNumber
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Master"
        buttonText="Add Driver"
        onAdd={() => setDialogOpen(true)}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search Driver..."
        onExport={() => console.log("Export")}
        onRefresh={() => console.log("Refresh")}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>License No.</TableHead>
                <TableHead>License Expiry</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredDrivers.length > 0 ? (
                filteredDrivers.map((driver) => (
                  <TableRow key={driver.licenseNumber}>
                    <TableCell className="font-medium">
                      {driver.driverName}
                    </TableCell>

                    <TableCell>
                      {driver.mobile}
                    </TableCell>

                    <TableCell>
                      {driver.licenseNumber}
                    </TableCell>

                    <TableCell>
                      {driver.licenseExpiry}
                    </TableCell>

                    <TableCell>
                      {driver.address}
                    </TableCell>

                    <TableCell>
                      <Badge className="bg-green-600 hover:bg-green-600">
                        {driver.status}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                        >
                          Edit
                        </Button>

                        <Button
                          variant="destructive"
                          size="sm"
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
                    colSpan={7}
                    className="py-10 text-center text-slate-500"
                  >
                    No drivers found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DriverDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}