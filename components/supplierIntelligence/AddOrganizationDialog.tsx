"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createSupplierOrganization,
  formatSupplierError,
  listSupplierOrganizationTypes,
  type SupplierOrganization,
  type SupplierOrganizationType,
} from "@/components/services/supplierIntelligence.service";

interface AddOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (organization: SupplierOrganization) => void;
}

export default function AddOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
}: AddOrganizationDialogProps) {
  const [types, setTypes] = useState<SupplierOrganizationType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [typeId, setTypeId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTypesLoading(true);
    listSupplierOrganizationTypes()
      .then((rows) => {
        if (cancelled) return;
        setTypes(rows);
        setTypeId((prev) => prev || rows[0]?.id || "");
      })
      .catch((error) => {
        console.error(error);
        toast.error(
          formatSupplierError(error, "Unable to load organization types.")
        );
      })
      .finally(() => {
        if (!cancelled) setTypesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setName("");
    setCode("");
    setNotes("");
    setTypeId(types[0]?.id || "");
  }

  async function handleSave() {
    if (saving) return;
    if (!name.trim()) {
      toast.error("Enter an organization name.");
      return;
    }
    if (!typeId) {
      toast.error("Select an organization type.");
      return;
    }

    try {
      setSaving(true);
      const created = await createSupplierOrganization({
        name,
        code,
        notes,
        organizationTypeId: typeId,
      });
      toast.success("Organization created.");
      onCreated(created);
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(
        formatSupplierError(error, "Unable to create organization. Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Organization</DialogTitle>
          <DialogDescription>
            Create an organization for Supplier Intelligence. Types come from
            the shared reference list (Supplier, Consignee, Municipality, …).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-org-name">Name</Label>
            <Input
              id="supplier-org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              autoFocus
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-org-type">Type</Label>
            <select
              id="supplier-org-type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              disabled={saving || typesLoading}
              className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            >
              {typesLoading ? (
                <option value="">Loading…</option>
              ) : types.length === 0 ? (
                <option value="">No types available</option>
              ) : (
                types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-org-code">Code (optional)</Label>
            <Input
              id="supplier-org-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Internal code"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-org-notes">Notes (optional)</Label>
            <Textarea
              id="supplier-org-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-foreground"
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || typesLoading}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
