"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import FormSelect from "@/components/ui/FormSelect";
import {
  PERMISSION_MODULES,
  PERMISSION_LEVEL_LABELS,
  PERMISSION_LEVELS,
  type PermissionKey,
  type PermissionLevel,
} from "@/lib/permissions";
import type { AppUserProfile } from "@/components/services/appUser.service";
import { updateAppUserFullAccess } from "@/components/services/appUser.service";
import { getUserPermissions, setUserPermission, type PermissionMap } from "@/components/services/permission.service";

const LEVEL_OPTIONS = PERMISSION_LEVELS.map((level) => ({
  value: level,
  label: PERMISSION_LEVEL_LABELS[level],
}));

interface StaffPermissionsDialogProps {
  user: AppUserProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Admin-only "Edit Permissions" dialog for a single staff account
 * (migration 019). Full Access ON makes every individual module
 * control below irrelevant (the account behaves as Edit everywhere)
 * — mirrored by `hasPermission()` in `lib/auth/AuthProvider.tsx`, so
 * disabling the per-module selects here is purely a UI hint, not a
 * second source of truth.
 */
export default function StaffPermissionsDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: StaffPermissionsDialogProps) {
  const [fullAccess, setFullAccess] = useState(false);
  const [levels, setLevels] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;

    setFullAccess(user.fullAccess);
    setLoading(true);

    getUserPermissions(user.id)
      .then(setLevels)
      .catch((error) => {
        console.error(error);
        toast.error("Unable to load this user's permissions.");
      })
      .finally(() => setLoading(false));
  }, [open, user]);

  function handleLevelChange(key: PermissionKey, value: string) {
    setLevels((prev) => ({ ...prev, [key]: value as PermissionLevel }));
  }

  async function handleSave() {
    if (!user) return;

    try {
      setSaving(true);

      if (fullAccess !== user.fullAccess) {
        await updateAppUserFullAccess(user.id, fullAccess);
      }

      await Promise.all(
        PERMISSION_MODULES.map((module) =>
          setUserPermission(user.id, module.key, levels[module.key] ?? "none")
        )
      );

      toast.success(`Permissions updated for ${user.displayName}.`);
      onSaved();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Unable to save permissions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Permissions{user ? ` — ${user.displayName}` : ""}</DialogTitle>
          <DialogDescription>
            Control exactly what this staff member can see and do in each module.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setFullAccess((prev) => !prev)}
            className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
              fullAccess ? "border-primary bg-primary/5" : "border-border bg-background"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className={`h-4 w-4 ${fullAccess ? "text-primary" : "text-muted-foreground/50"}`} />
              Full Access
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                fullAccess ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {fullAccess ? "ON" : "OFF"}
            </span>
          </button>

          <p className="text-xs text-muted-foreground">
            When Full Access is ON, this account can create/view/edit every module below,
            regardless of the individual settings. Turn it OFF to control each module separately.
          </p>

          <div className={`space-y-3 ${fullAccess ? "pointer-events-none opacity-50" : ""}`}>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              PERMISSION_MODULES.map((module) => (
                <FormSelect
                  key={module.key}
                  label={module.label}
                  value={levels[module.key] ?? "none"}
                  onValueChange={(value) => handleLevelChange(module.key, value)}
                  options={LEVEL_OPTIONS}
                  disabled={fullAccess}
                />
              ))
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save Permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
