"use client";

import { useState } from "react";

import { LR } from "../types";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import MaterialLookup from "@/components/lookup/MaterialLookup";
import { MaterialData } from "@/components/data";

interface MaterialSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function MaterialSection({
  lr,
  onChange,
}: MaterialSectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);

  function handleMaterialSelect(material: MaterialData) {
    onChange({
      ...lr,
      material: material.material,
      packageType: material.packageType,
    });

    setLookupOpen(false);
  }

  return (
    <>
      <div className="rounded-xl border bg-white shadow-sm p-6 space-y-6">
        <div className="border-b pb-3">
          <h2 className="text-xl font-semibold">
            Material Details
          </h2>

          <p className="text-sm text-slate-500 mt-1">
            Goods being transported
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

          {/* Material */}

          <div className="lg:col-span-2">
            <label className="block text-sm font-medium mb-2">
              Material *
            </label>

            <div className="flex gap-3">
              <Input
                placeholder="Select or enter material"
                value={lr.material}
                onChange={(e) =>
                  onChange({
                    ...lr,
                    material: e.target.value,
                  })
                }
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </div>

          {/* Package Type */}

          <div>
            <label className="block text-sm font-medium mb-2">
              Package Type
            </label>

            <Input
              placeholder="Bundle / Bag / Coil"
              value={lr.packageType}
              onChange={(e) =>
                onChange({
                  ...lr,
                  packageType: e.target.value,
                })
              }
            />
          </div>

          {/* Packages */}

          <div>
            <label className="block text-sm font-medium mb-2">
              No. of Packages
            </label>

            <Input
              type="number"
              value={lr.packages}
              onChange={(e) =>
                onChange({
                  ...lr,
                  packages: Number(e.target.value),
                })
              }
            />
          </div>

          {/* Loading */}

          <div>
            <label className="block text-sm font-medium mb-2">
              Loading Weight (MT)
            </label>

            <Input
              type="number"
              value={lr.loadingWeight}
              onChange={(e) =>
                onChange({
                  ...lr,
                  loadingWeight: Number(e.target.value),
                })
              }
            />
          </div>

          {/* Unloading */}

          <div>
            <label className="block text-sm font-medium mb-2">
              Unloading Weight (MT)
            </label>

            <Input
              type="number"
              value={lr.unloadingWeight}
              onChange={(e) =>
                onChange({
                  ...lr,
                  unloadingWeight: Number(e.target.value),
                })
              }
            />
          </div>

          {/* Charged */}

          <div>
            <label className="block text-sm font-medium mb-2">
              Charged Weight (MT)
            </label>

            <Input
              type="number"
              value={lr.chargedWeight}
              onChange={(e) =>
                onChange({
                  ...lr,
                  chargedWeight: Number(e.target.value),
                })
              }
            />
          </div>

        </div>
      </div>

      <MaterialLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleMaterialSelect}
      />
    </>
  );
}