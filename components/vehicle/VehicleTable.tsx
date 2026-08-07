"use client";

import { useState } from "react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import VehicleDialog from "./VehicleDialog";

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

const vehicles = [
  {
    vehicleNumber: "MH12AB1234",
    vehicleType: "Truck",
    ownerName: "Ramesh Patil",
    mobile: "9876543210",
    rcNumber: "RC123456",
    insuranceNumber: "INS987654",
    status: "Active",
  },
  {
    vehicleNumber: "MH14XY5678",
    vehicleType: "Trailer",
    ownerName: "Suresh Shah",
    mobile: "9822001122",
    rcNumber: "RC654321",
    insuranceNumber: "INS123456",
    status: "Active",
  },
];

export default function VehicleTable() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filteredVehicles = vehicles.filter(
    (vehicle) =>
      vehicle.vehicleNumber
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      vehicle.ownerName
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Master"
        buttonText="Add Vehicle"
        onAdd={() => setDialogOpen(true)}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search Vehicle..."
        onExport={() => console.log("Export")}
        onRefresh={() => console.log("Refresh")}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle No</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>RC No</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredVehicles.length > 0 ? (
                filteredVehicles.map((vehicle) => (
                  <TableRow key={vehicle.vehicleNumber}>
                    <TableCell className="font-medium">
                      {vehicle.vehicleNumber}
                    </TableCell>

                    <TableCell>{vehicle.vehicleType}</TableCell>

                    <TableCell>{vehicle.ownerName}</TableCell>

                    <TableCell>{vehicle.mobile}</TableCell>

                    <TableCell>{vehicle.rcNumber}</TableCell>

                    <TableCell>
                      <Badge className="bg-green-600 hover:bg-green-600">
                        {vehicle.status}
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
                    No vehicles found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <VehicleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}