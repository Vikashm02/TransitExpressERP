"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getWhatsappAccessErrorMessage } from "@/lib/errors/whatsappAccessError";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppUserProfile } from "@/components/services/appUser.service";
import { setWhatsappPhoneNumber, type WhatsappAccessRow } from "@/components/services/whatsappAccess.service";
import {
  canSubmitWhatsappPhone,
  previewIndiaWhatsappPhone,
} from "@/lib/whatsappAccessRules";

interface WhatsappAccessDialogProps {
  /** Target account (Creator manages admin/staff only; never self/Creator). */
  target: AppUserProfile | null;
  /** Latest M114 list row for the target (may be null if unavailable). */
  access: WhatsappAccessRow | null;
  mode: "enable" | "change";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Creator-only Enable/Change dialog for a staff member's WhatsApp Assistant
 * number. M114 remains authoritative; this UI only previews the canonical
 * number and requires explicit Creator confirmation before submit.
 */
export default function WhatsappAccessDialog({
  target,
  access,
  mode,
  open,
  onOpenChange,
  onSaved,
}: WhatsappAccessDialogProps) {
  const [phoneInput, setPhoneInput] = useState("");
  const [confirmedCanonical, setConfirmedCanonical] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset form state whenever the dialog is (re)opened for a different
  // target/mode — the React-recommended render-time state reset pattern.
  const dialogKey = `${open}:${target?.id ?? ""}:${mode}`;
  const [prevDialogKey, setPrevDialogKey] = useState(dialogKey);
  if (dialogKey !== prevDialogKey) {
    setPrevDialogKey(dialogKey);
    if (open) {
      setPhoneInput("");
      setConfirmedCanonical(null);
      setSaving(false);
    }
  }

  const preview = previewIndiaWhatsappPhone(phoneInput);
  const inputTouched = phoneInput.trim().length > 0;
  const confirmationMatches = preview !== null && confirmedCanonical === preview;
  const canSubmit = canSubmitWhatsappPhone(phoneInput, confirmedCanonical) && !saving;

  async function handleSubmit() {
    if (!target || !canSubmit) return;
    try {
      setSaving(true);
      // Submit the typed input — the server, not the preview, is authoritative.
      const result = await setWhatsappPhoneNumber(target.id, phoneInput);
      toast.success(
        result.status === "unchanged"
          ? `${target.displayName} already uses ${result.whatsappPhoneE164}.`
          : `WhatsApp access ${mode === "change" ? "updated" : "enabled"} for ${target.displayName}: ${result.whatsappPhoneE164}.`
      );
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getWhatsappAccessErrorMessage(error, "Unable to update WhatsApp access.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "change" ? "Change WhatsApp Number" : "Enable WhatsApp"}
            {target ? ` — ${target.displayName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Link a canonical Indian WhatsApp number to this account. LR/POD
            access continues to come from the existing ERP permissions and is
            not changed here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Current number:</span>{" "}
              {access?.whatsappPhoneE164 ?? "Not configured"}
            </p>
            <p className="mt-1">
              <span className="font-medium text-foreground">Effective access:</span>{" "}
              LR {access?.effectiveLrAccess ? "allowed" : "not allowed"} · POD{" "}
              {access?.effectivePodAccess ? "allowed" : "not allowed"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="whatsapp-phone-input">WhatsApp number</Label>
            <Input
              id="whatsapp-phone-input"
              value={phoneInput}
              onChange={(event) => {
                setPhoneInput(event.target.value);
                // Any typed change invalidates the previous explicit confirmation.
                setConfirmedCanonical(null);
              }}
              placeholder="9876543210 or +91 98765 43210"
              autoComplete="off"
              aria-invalid={inputTouched && preview === null}
            />
            <p className="text-xs text-muted-foreground">
              Accepted: 9876543210, 919876543210, +919876543210, 91 98765 43210,
              91-98765-43210.
            </p>
            {inputTouched && preview === null && (
              <p className="text-xs font-medium text-destructive">
                Invalid Indian mobile number. Enter a 10-digit Indian mobile
                number, optionally with the +91 country code.
              </p>
            )}
            {preview !== null && (
              <p className="text-xs text-muted-foreground">
                Will be saved as:{" "}
                <span className="font-mono font-medium text-foreground">{preview}</span>
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-1 size-4"
              disabled={preview === null}
              checked={confirmationMatches}
              onChange={(event) => {
                setConfirmedCanonical(event.target.checked && preview ? preview : null);
              }}
            />
            <span>
              I confirm the exact canonical number{" "}
              <span className="font-mono font-medium">{preview ?? "+91XXXXXXXXXX"}</span>{" "}
              should receive WhatsApp Assistant access for this account.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Saving..." : mode === "change" ? "Save Number" : "Enable WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
