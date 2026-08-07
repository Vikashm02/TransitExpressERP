"use client";

import { useState } from "react";

import PageHeader from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function CompanyForm() {
  const [company, setCompany] = useState({
    companyName: "",
    gst: "",
    pan: "",
    contactPerson: "",
    mobile: "",
    email: "",
    website: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setCompany({
      ...company,
      [e.target.name]: e.target.value,
    });
  };

  const handleSave = () => {
    console.log(company);
    alert("Company saved successfully.");
  };

  return (
    <div className="space-y-6">

      <PageHeader
        title="Company"
        buttonText="Save Company"
        onAdd={handleSave}
      />

      <Card>
        <CardContent className="p-6">

          <div className="mb-8 flex flex-col items-center gap-6 md:flex-row">

            <div className="flex h-32 w-32 items-center justify-center rounded-xl border-2 border-dashed bg-slate-50">

              Logo

            </div>

            <div>

              <Button variant="outline">
                Upload Logo
              </Button>

              <p className="mt-2 text-sm text-muted-foreground">
                PNG or JPG (300x300 recommended)
              </p>

            </div>

          </div>

          <div className="grid gap-5 md:grid-cols-2">

            <Input
              name="companyName"
              placeholder="Company Name"
              value={company.companyName}
              onChange={handleChange}
            />

            <Input
              name="gst"
              placeholder="GST Number"
              value={company.gst}
              onChange={handleChange}
            />

            <Input
              name="pan"
              placeholder="PAN Number"
              value={company.pan}
              onChange={handleChange}
            />

            <Input
              name="contactPerson"
              placeholder="Contact Person"
              value={company.contactPerson}
              onChange={handleChange}
            />

            <Input
              name="mobile"
              placeholder="Mobile Number"
              value={company.mobile}
              onChange={handleChange}
            />

            <Input
              name="email"
              placeholder="Email"
              value={company.email}
              onChange={handleChange}
            />

            <Input
              name="website"
              placeholder="Website"
              value={company.website}
              onChange={handleChange}
            />

            <Input
              name="city"
              placeholder="City"
              value={company.city}
              onChange={handleChange}
            />

            <Input
              name="state"
              placeholder="State"
              value={company.state}
              onChange={handleChange}
            />

            <Input
              name="pincode"
              placeholder="Pincode"
              value={company.pincode}
              onChange={handleChange}
            />

            <div className="md:col-span-2">

              <Textarea
                name="address"
                placeholder="Company Address"
                value={company.address}
                onChange={handleChange}
              />

            </div>

          </div>

          <div className="mt-8 flex justify-end gap-3">

            <Button variant="outline">
              Cancel
            </Button>

            <Button
              onClick={handleSave}
            >
              Save Company
            </Button>

          </div>

        </CardContent>
      </Card>

    </div>
  );
}