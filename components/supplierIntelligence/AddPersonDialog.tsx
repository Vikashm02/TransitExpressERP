"use client";

import { useState } from "react";
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
  createSupplierPerson,
  formatSupplierError,
  type SupplierPerson,
} from "@/components/services/supplierIntelligence.service";

interface AddPersonDialogProps {
  open: boolean;
  organizationId: string;
  organizationName: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (person: SupplierPerson) => void;
}

export default function AddPersonDialog({
  open,
  organizationId,
  organizationName,
  onOpenChange,
  onCreated,
}: AddPersonDialogProps) {
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setDesignation("");
    setPhone("");
    setEmail("");
    setNotes("");
  }

  async function handleSave() {
    if (saving) return;
    if (!name.trim()) {
      toast.error("Enter a contact name.");
      return;
    }

    try {
      setSaving(true);
      const created = await createSupplierPerson({
        organizationId,
        name,
        designation,
        phone,
        email,
        notes,
        isPrimary: true,
      });
      toast.success("Contact created.");
      onCreated(created);
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(
        formatSupplierError(error, "Unable to create contact. Please try again.")
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
          <DialogTitle>Add Person</DialogTitle>
          <DialogDescription>
            Add a contact linked to {organizationName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-person-name">Name</Label>
            <Input
              id="supplier-person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact name"
              autoFocus
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-person-designation">Designation</Label>
            <Input
              id="supplier-person-designation"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="Role / title"
              disabled={saving}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-person-phone">Phone</Label>
              <Input
                id="supplier-person-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-person-email">Email</Label>
              <Input
                id="supplier-person-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-person-notes">Notes</Label>
            <Textarea
              id="supplier-person-notes"
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
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
