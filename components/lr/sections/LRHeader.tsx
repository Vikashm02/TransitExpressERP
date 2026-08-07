"use client";

import { LR } from "../types";
import { Input } from "@/components/ui/input";

interface LRHeaderProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function LRHeader({
  lr,
  onChange,
}: LRHeaderProps) {
  return (
    <div className="rounded-xl border bg-white shadow-sm p-6 space-y-6">

      <div className="border-b pb-3">

        <h2 className="text-xl font-semibold">
          LR Information
        </h2>

        <p className="text-sm text-slate-500 mt-1">
          Basic booking information
        </p>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">

        {/* LR Number */}

        <div>

          <label className="block text-sm font-medium mb-2">
            LR Number *
          </label>

          <Input
            placeholder="LR Number"
            value={lr.lrNumber}
            onChange={(e) =>
              onChange({
                ...lr,
                lrNumber: e.target.value,
              })
            }
          />

        </div>

        {/* LR Date */}

        <div>

          <label className="block text-sm font-medium mb-2">
            LR Date
          </label>

          <Input
            type="date"
            value={lr.lrDate}
            onChange={(e) =>
              onChange({
                ...lr,
                lrDate: e.target.value,
              })
            }
          />

        </div>

        {/* Booking Branch */}

        <div>

          <label className="block text-sm font-medium mb-2">
            Booking Branch *
          </label>

          <select
            className="w-full h-10 rounded-md border px-3 bg-white"
            value={lr.bookingBranch}
            onChange={(e) =>
              onChange({
                ...lr,
                bookingBranch: e.target.value,
              })
            }
          >
            <option value="">
              Select Branch
            </option>

            <option value="Visakhapatnam">
              Visakhapatnam
            </option>

            <option value="Shahabad">
              Shahabad
            </option>

          </select>

        </div>

        {/* Customer */}

        <div>

          <label className="block text-sm font-medium mb-2">
            Customer
          </label>

          <Input
            placeholder="Customer Name"
            value={lr.customer}
            onChange={(e) =>
              onChange({
                ...lr,
                customer: e.target.value,
              })
            }
          />

        </div>

      </div>

    </div>
  );
}