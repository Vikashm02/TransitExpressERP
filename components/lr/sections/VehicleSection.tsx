"use client";

import { LR } from "../types";
import { Input } from "@/components/ui/input";

interface VehicleSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function VehicleSection({
  lr,
  onChange,
}: VehicleSectionProps) {
  return (
    <div className="rounded-xl border bg-white p-6 space-y-6 shadow-sm">

      <h2 className="text-xl font-semibold border-b pb-3">
        Vehicle & Route Details
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

        <div>
          <label className="mb-2 block text-sm font-medium">
            Vehicle Number *
          </label>

          <Input
            placeholder="MH12AB1234"
            value={lr.vehicleNumber}
            onChange={(e) =>
              onChange({
                ...lr,
                vehicleNumber: e.target.value.toUpperCase(),
              })
            }
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            Vehicle Type
          </label>

          <Input
            placeholder="Truck / Trailer / Container"
            value={lr.vehicleType}
            onChange={(e) =>
              onChange({
                ...lr,
                vehicleType: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            Transporter
          </label>

          <Input
            placeholder="Transporter Name"
            value={lr.transporter}
            onChange={(e) =>
              onChange({
                ...lr,
                transporter: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            Driver Name
          </label>

          <Input
            placeholder="Driver Name"
            value={lr.driverName}
            onChange={(e) =>
              onChange({
                ...lr,
                driverName: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            Driver Mobile
          </label>

          <Input
            placeholder="9876543210"
            value={lr.driverMobile}
            onChange={(e) =>
              onChange({
                ...lr,
                driverMobile: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            From
          </label>

          <Input
            placeholder="Loading Station"
            value={lr.from}
            onChange={(e) =>
              onChange({
                ...lr,
                from: e.target.value,
              })
            }
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            To
          </label>

          <Input
            placeholder="Destination"
            value={lr.to}
            onChange={(e) =>
              onChange({
                ...lr,
                to: e.target.value,
              })
            }
          />
        </div>

      </div>
    </div>
  );
}