"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
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
import {
  MODULE_SUPPORTED_ACTIONS,
  PERMISSION_ACTION_LABELS,
  PERMISSION_MODULES,
  EMPTY_MODULE_ACTIONS,
  type ModuleActions,
  type PermissionAction,
  type PermissionKey,
} from "@/lib/permissions";
import type { AppUserProfile } from "@/components/services/appUser.service";
import { updateAppUserFullAccess } from "@/components/services/appUser.service";
import {
  getUserPermissionActions,
  setUserModuleActions,
  type PermissionActionsMap,
} from "@/components/services/permission.service";

interface StaffPermissionsDialogProps {
  user: AppUserProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Admin-only "Edit Permissions" dialog — independent action toggles
 * per module (migration 033).
 */
export default function StaffPermissionsDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: StaffPermissionsDialogProps) {
  const [fullAccess, setFullAccess] = useState(false);
  const [actionsMap, setActionsMap] = useState<PermissionActionsMap>({});
  const [loading, setLoading] = useState(false);
  /** True when this user's current permissions could not be loaded; saving is
   * blocked so an empty or previous user's map is never written over theirs. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;

    let cancelled = false;
    setFullAccess(user.fullAccess);
    // Never show (or save) the previously opened user's permissions.
    setActionsMap({});
    setLoadFailed(false);
    setLoading(true);

    getUserPermissionActions(user.id)
      .then((map) => {
        if (!cancelled) setActionsMap(map);
      })
      .catch((error) => {
        console.error(error);
        if (cancelled) return;
        setLoadFailed(true);
        toast.error(getUserFacingError(error, "Unable to load this user's permissions."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, user]);

  function toggleAction(key: PermissionKey, action: PermissionAction) {
    setActionsMap((prev) => {
      const current = { ...(prev[key] ?? EMPTY_MODULE_ACTIONS) };
      current[action] = !current[action];
      if (action === "view" && !current.view) {
        // Turning View off clears dependent actions that require visibility.
        current.create = false;
        current.edit = false;
        current.delete = false;
        current.print = false;
        current.share = false;
      }
      if (action !== "view" && current[action]) {
        current.view = true;
      }
      return { ...prev, [key]: current };
    });
  }

  async function handleSave() {
    if (!user || loading || loadFailed) return;

    try {
      setSaving(true);

      if (fullAccess !== user.fullAccess) {
        await updateAppUserFullAccess(user.id, fullAccess);
      }

      await Promise.all(
        PERMISSION_MODULES.map((module) =>
          setUserModuleActions(
            user.id,
            module.key,
            actionsMap[module.key] ?? EMPTY_MODULE_ACTIONS
          )
        )
      );

      toast.success(`Permissions updated for ${user.displayName}.`);
      onSaved();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to save permissions."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Permissions{user ? ` — ${user.displayName}` : ""}</DialogTitle>
          <DialogDescription>
            Control View, Create, Edit, Print and Share independently for each module.
            Delete is Creator-only and cannot be granted to staff.
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
            When Full Access is ON, this account can perform every action in every module.
            Turn it OFF to control each action separately.
          </p>

          <div className={`space-y-4 ${fullAccess ? "pointer-events-none opacity-50" : ""}`}>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : loadFailed ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                This person&apos;s current permissions could not be loaded, so saving is turned off
                to protect them. Close this window and open Edit Permissions again.
              </p>
            ) : (
              PERMISSION_MODULES.map((module) => {
                const actions: ModuleActions = actionsMap[module.key] ?? EMPTY_MODULE_ACTIONS;
                const supported = MODULE_SUPPORTED_ACTIONS[module.key];
                return (
                  <div key={module.key} className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-sm font-medium text-foreground">{module.label}</p>
                    {module.description ? (
                      <p className="mb-2 text-xs text-muted-foreground">{module.description}</p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {supported.map((action) => {
                        const on = actions[action];
                        return (
                          <button
                            key={action}
                            type="button"
                            disabled={fullAccess}
                            onClick={() => toggleAction(module.key, action)}
                            className={`flex items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                              on
                                ? "border-primary/40 bg-primary/5 text-foreground"
                                : "border-border bg-background text-muted-foreground"
                            }`}
                            aria-pressed={on}
                          >
                            <span>{PERMISSION_ACTION_LABELS[action]}</span>
                            <span className={on ? "text-primary" : ""}>{on ? "ON" : "OFF"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || loadFailed}>
            {saving ? "Saving..." : "Save Permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
