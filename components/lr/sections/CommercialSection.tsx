"use client";

import { Input } from "@/components/ui/input";
import { LR } from "../types";

import { calculateLR } from "@/lib/calculations/lrCalculations";

interface CommercialSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function CommercialSection({
  lr,
  onChange,
}: CommercialSectionProps) {

  const calc = calculateLR(lr);

  return (
    <div className="rounded-lg border p-5 space-y-8">

      <h2 className="text-lg font-semibold">
        Commercial Details
      </h2>

      {/* ================= BILLING ================= */}

      <div className="space-y-4">

        <h3 className="font-medium text-base">
          Billing
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

          <div>

            <label className="text-sm font-medium mb-1 block">
              Bill Rate
            </label>

            <Input
              type="number"
              value={lr.billRate}
              onChange={(e) =>
                onChange({
                  ...lr,
                  billRate: Number(e.target.value),
                })
              }
            />

          </div>

          <div>

            <label className="text-sm font-medium mb-1 block">
              Bill Rate Type
            </label>

            <select
              className="w-full h-10 rounded-md border px-3"
              value={lr.billRateType}
              onChange={(e) =>
                onChange({
                  ...lr,
                  billRateType:
                    e.target.value as LR["billRateType"],
                })
              }
            >
              <option value="Fixed">Fixed</option>
              <option value="Per Ton (Loading)">
                Per Ton (Loading)
              </option>
              <option value="Per Ton (Unloading)">
                Per Ton (Unloading)
              </option>
              <option value="Guaranteed Weight">
                Guaranteed Weight
              </option>
            </select>

          </div>

          <div>

            <label className="text-sm font-medium mb-1 block">
              Guaranteed Weight
            </label>

            <Input
              type="number"
              value={lr.guaranteedWeight}
              onChange={(e) =>
                onChange({
                  ...lr,
                  guaranteedWeight: Number(e.target.value),
                })
              }
            />

          </div>

          <div>

            <label className="text-sm font-medium mb-1 block">
              Bill Amount
            </label>

            <Input
              readOnly
              value={calc.billAmount}
            />

          </div>

        </div>

      </div>

      {/* ================= LORRY HIRE ================= */}

      <div className="space-y-4">

        <h3 className="font-medium text-base">
          Lorry Hire
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          <div>

            <label className="text-sm font-medium mb-1 block">
              Hire Rate
            </label>

            <Input
              type="number"
              value={lr.lorryHireRate}
              onChange={(e) =>
                onChange({
                  ...lr,
                  lorryHireRate: Number(e.target.value),
                })
              }
            />

          </div>

          <div>

            <label className="text-sm font-medium mb-1 block">
              Hire Type
            </label>

            <select
              className="w-full h-10 rounded-md border px-3"
              value={lr.lorryHireType}
              onChange={(e) =>
                onChange({
                  ...lr,
                  lorryHireType:
                    e.target.value as LR["lorryHireType"],
                })
              }
            >
              <option value="Fixed">Fixed</option>
              <option value="Per Ton">
                Per Ton
              </option>
            </select>

          </div>

          <div>

            <label className="text-sm font-medium mb-1 block">
              Hire Amount
            </label>

            <Input
              readOnly
              value={calc.lorryHireAmount}
            />

          </div>

        </div>

      </div>

      {/* ================= EXPENSES ================= */}

      <div className="space-y-4">

        <h3 className="font-medium text-base">
          Expenses
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

          <Input
            type="number"
            placeholder="Driver Advance"
            value={lr.driverAdvance}
            onChange={(e) =>
              onChange({
                ...lr,
                driverAdvance: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="Diesel Advance"
            value={lr.dieselAdvance}
            onChange={(e) =>
              onChange({
                ...lr,
                dieselAdvance: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="ST Challan"
            value={lr.stChallan}
            onChange={(e) =>
              onChange({
                ...lr,
                stChallan: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="Loading Charges"
            value={lr.loadingCharges}
            onChange={(e) =>
              onChange({
                ...lr,
                loadingCharges: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="Unloading Charges"
            value={lr.unloadingCharges}
            onChange={(e) =>
              onChange({
                ...lr,
                unloadingCharges: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="Hamali"
            value={lr.hamali}
            onChange={(e) =>
              onChange({
                ...lr,
                hamali: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="Commission"
            value={lr.commission}
            onChange={(e) =>
              onChange({
                ...lr,
                commission: Number(e.target.value),
              })
            }
          />

          <Input
            type="number"
            placeholder="Other Expense"
            value={lr.otherExpense}
            onChange={(e) =>
              onChange({
                ...lr,
                otherExpense: Number(e.target.value),
              })
            }
          />

        </div>

      </div>

      {/* ================= SUMMARY ================= */}

      <div className="rounded-lg border bg-muted/40 p-5">

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

          <div>
            <p className="text-sm text-muted-foreground">
              Bill Amount
            </p>

            <p className="text-xl font-semibold">
              ₹ {calc.billAmount.toFixed(2)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              Lorry Hire
            </p>

            <p className="text-xl font-semibold">
              ₹ {calc.lorryHireAmount.toFixed(2)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              Total Expense
            </p>

            <p className="text-xl font-semibold">
              ₹ {calc.totalExpense.toFixed(2)}
            </p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              Profit / Loss
            </p>

            <p
              className={`text-2xl font-bold ${
                calc.profit >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              ₹ {calc.profit.toFixed(2)}
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}