"use client";

import { useState } from "react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import CustomerDialog from "./CustomerDialog";

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

const customers = [
  {
    code: "C001",
    name: "ABC Steel Ltd",
    city: "Pune",
    mobile: "9876543210",
    gst: "27ABCDE1234F1Z5",
    status: "Active",
  },
  {
    code: "C002",
    name: "XYZ Industries",
    city: "Mumbai",
    mobile: "9876500000",
    gst: "27XYZAB5678P1Z2",
    status: "Active",
  },
];

export default function CustomerTable() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filteredCustomers = customers.filter((customer) =>
    customer.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        buttonText="Add Customer"
        onAdd={() => setDialogOpen(true)}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search Customer..."
        onExport={() => console.log("Export")}
        onRefresh={() => console.log("Refresh")}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredCustomers.length > 0 ? (
                filteredCustomers.map((customer) => (
                  <TableRow key={customer.code}>
                    <TableCell>{customer.code}</TableCell>

                    <TableCell className="font-medium">
                      {customer.name}
                    </TableCell>

                    <TableCell>{customer.gst}</TableCell>

                    <TableCell>{customer.mobile}</TableCell>

                    <TableCell>{customer.city}</TableCell>

                    <TableCell>
                      <Badge className="bg-green-600 hover:bg-green-600">
                        {customer.status}
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
                    className="text-center py-10 text-slate-500"
                  >
                    No customers found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}