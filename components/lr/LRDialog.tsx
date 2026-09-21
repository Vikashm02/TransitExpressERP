"use client";

import { useEffect, useRef, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import LRForm from "./LRForm";
import { validateLR, type LR } from "./lr.schema";
import type { FieldErrors } from "@/lib/validation";
import type { LRRecord } from "@/components/services/lr.service";
import { getCompany } from "@/components/services/company.service";
import { pickFields } from "@/lib/utils";
import { isDraftEntry, isDraftLrNumber } from "@/lib/entryStatus";
import { prepareLrForDraftForm } from "@/lib/draftPersistence";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";
import { normalizeLrTextFields } from "./lrTextNormalize";
import { getActiveLrPurchaseOrders } from "@/components/services/purchaseOrder.service";
import { toast } from "sonner";

interface LRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to view/edit; omit/null to add a new LR. */
  lr?: LRRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  /** View mode: read-only fields, no Save, no autosave. */
  readOnly?: boolean;
  /** Shown in view mode when the user may switch to edit (final LRs only). */
  onRequestEdit?: () => void;
  /** Shown in view mode when the user may continue a draft. */
  onRequestContinueDraft?: () => void;
  onSubmit: (values: LR) => void | Promise<void>;
  /**
   * Optional draft autosave — does not finalize numbering. Ignored when readOnly.
   * Accepts `{ waitForDrain: true }` so explicit Save Draft / Close-flush can
   * await durability when queuing behind an in-flight autosave (LRListPage).
   */
  onAutosave?: (values: LR, opts?: { waitForDrain?: boolean }) => void | Promise<void>;
  notificationFocus?: string | null;
}

const emptyLR: LR = {
  // LR Information
  lrNumber: "",
  lrDate: "",
  bookingBranch: "",
  customer: "",
  billingParty: "Consignor",

  // Consignor
  consignor: "",
  consignorGST: "",
  consignorAddress: "",

  // Consignee
  consignee: "",
  consigneeGST: "",
  consigneeAddress: "",

  // Vehicle & Route
  vehicleNumber: "",
  vehicleType: "",
  transporter: "",
  driverName: "",
  driverMobile: "",
  from: "",
  to: "",

  // Material
  material: "",
  materialDescription: "",
  packageType: "",
  packages: 0,
  loadingWeight: 0,
  unloadingWeight: 0,
  chargedWeight: 0,

  // Dispatch Documents
  poNumber: "",
  poDate: "",
  purchaseOrderId: null,
  vendorCode: "",
  dcNumber: "",
  dcDate: "",
  invoiceNumber: "",
  invoiceDate: "",
  invoiceValue: 0,
  ewayBillNumber: "",

  // Commercial
  billRate: 0,
  billRateType: "Fixed",
  guaranteedWeight: 0,
  lorryHireRate: 0,
  lorryHireType: "Fixed",
  lorryHireGuaranteedWeight: 0,
  freightType: "To Be Billed",

  driverAdvance: 0,
  dieselAdvance: 0,
  stChallan: 0,
  loadingCharges: 0,
  unloadingCharges: 0,
  hamali: 0,
  commission: 0,
  otherExpense: 0,

  // Remarks
  remarks: "",
  internalRemarks: "",

  // Status
  status: "Open",
  entryStatus: "final",
};

/** Picks only the `LR` schema fields off an `LRRecord`, dropping
 * server-owned columns (`id`, `created_at`) and the computed commercial
 * columns (`billAmount`, `lorryHireAmount`, `profitAmount` — always
 * recomputed from `calculateLR()` at save time, never edited directly) so
 * none of them enter editable form state or `updateLR()`'s payload. */
function toEditableLR(record: LRRecord): LR {
  const picked = pickFields(record, Object.keys(emptyLR) as (keyof LR)[]);
  // Defense in depth: never seed controlled inputs with null/undefined.
  const safe = { ...emptyLR, ...picked } as LR;
  for (const key of Object.keys(emptyLR) as (keyof LR)[]) {
    const fallback = emptyLR[key];
    if (safe[key] == null) {
      (safe as Record<string, unknown>)[key as string] = fallback;
    }
  }
  // Strip DB-only draft placeholders ("Draft" / "DRAFT") so empty fields
  // stay blank when resuming an incomplete LR.
  return prepareLrForDraftForm(safe);
}

export default function LRDialog({
  open,
  onOpenChange,
  lr,
  loading = false,
  readOnly = false,
  onRequestEdit,
  onRequestContinueDraft,
  onSubmit,
  onAutosave,
  notificationFocus = null,
}: LRDialogProps) {
  const [values, setValues] = useState<LR>(emptyLR);
  const [errors, setErrors] = useState<FieldErrors<LR>>({});
  const [draftHint, setDraftHint] = useState<string | null>(null);
  const [checkingPo, setCheckingPo] = useState(false);
  /** Track which persisted row the form was seeded from (avoid wipe on autosave). */
  const seededLrIdRef = useRef<number | null>(null);
  /** True when this dialog open started as Create (no lr) — number attach must not reset form. */
  const openedAsCreateRef = useRef(false);

  /** Central path: typing, paste, lookups, load, and freight default all go through here. */
  function setLrValues(next: LR | ((prev: LR) => LR)) {
    if (readOnly) return;
    setValues((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      return normalizeLrTextFields(resolved);
    });
  }

  const isEditing = Boolean(lr);

  /** Required for brand-new LRs and drafts being finalized — not historical finals. */
  const requireMaterialDescription =
    !isEditing ||
    isDraftEntry(lr?.entryStatus) ||
    isDraftLrNumber(lr?.lrNumber);

  const [draftSaving, setDraftSaving] = useState(false);

  /** Existing meaningful-draft condition: Consignor OR Consignee. */
  const hasMeaningfulDraft =
    values.consignor.trim().length > 0 || values.consignee.trim().length > 0;

  /**
   * Save Draft surface: brand-new create plus existing-draft continuation
   * (updates the same draft, never allocates again). Never view mode,
   * never finalized-LR edit mode.
   */
  const showSaveDraft =
    !readOnly && (!isEditing || isDraftEntry(lr?.entryStatus));

  const { cancelPending: cancelPendingAutosave } = useDebouncedAutosave({
    values,
    enabled:
      open &&
      !readOnly &&
      Boolean(onAutosave) &&
      !loading &&
      hasMeaningfulDraft,
    delayMs: 2500,
    onSave: async (next) => {
      if (readOnly || !onAutosave) return;
      try {
        await onAutosave({ ...next, entryStatus: "draft" });
        setDraftHint("Draft saved");
      } catch {
        // Quiet
      }
    },
  });

  /**
   * Explicit Save Draft: cancel any pending debounce, then persist latest
   * values through the existing autosave path (single numbered draft,
   * same-draft updates, waitForDrain durability). Never validates or
   * finalizes — Save LR remains the only finalize action.
   */
  async function handleSaveDraft() {
    if (readOnly || !onAutosave || draftSaving) return;
    if (!hasMeaningfulDraft) {
      toast.error("Enter Consignor or Consignee to save a draft.");
      return;
    }
    cancelPendingAutosave();
    setDraftSaving(true);
    try {
      await onAutosave({ ...values, entryStatus: "draft" }, { waitForDrain: true });
      toast.success("Draft saved");
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Draft could not be saved. Please try again.");
    } finally {
      setDraftSaving(false);
    }
  }

  /**
   * Close/Back protection: flush a meaningful pending draft before the
   * dialog closes, awaiting durability. Keeps the dialog open with a safe
   * error on failure; closes normally when there is nothing to save.
   */
  async function requestDialogClose() {
    if (
      !readOnly &&
      showSaveDraft &&
      onAutosave &&
      !draftSaving &&
      hasMeaningfulDraft
    ) {
      cancelPendingAutosave();
      setDraftSaving(true);
      try {
        await onAutosave({ ...values, entryStatus: "draft" }, { waitForDrain: true });
      } catch (error) {
        console.error(error);
        toast.error("Draft could not be saved. Please try again.");
        setDraftSaving(false);
        return;
      }
      setDraftSaving(false);
    }
    onOpenChange(false);
  }

  useEffect(() => {
    if (!open) {
      seededLrIdRef.current = null;
      openedAsCreateRef.current = false;
      return;
    }

    setErrors({});

    // Same draft row after first create / autosave: only sync reserved number.
    if (lr && seededLrIdRef.current === lr.id) {
      const reserved =
        lr.lrNumber?.trim() && !isDraftLrNumber(lr.lrNumber) ? lr.lrNumber.trim() : "";
      if (reserved) {
        setValues((prev) =>
          prev.lrNumber === reserved
            ? prev
            : normalizeLrTextFields({ ...prev, lrNumber: reserved, entryStatus: "draft" })
        );
      }
      setDraftHint(
        readOnly
          ? null
          : lr.entryStatus === "draft"
            ? "Incomplete draft — continue editing, then Save."
            : null
      );
      return;
    }

    // Create session: first time a draft row appears — attach id + number only.
    if (lr && openedAsCreateRef.current && seededLrIdRef.current == null && !readOnly) {
      const reserved =
        lr.lrNumber?.trim() && !isDraftLrNumber(lr.lrNumber) ? lr.lrNumber.trim() : "";
      seededLrIdRef.current = lr.id;
      setValues((prev) =>
        normalizeLrTextFields({
          ...prev,
          ...(reserved ? { lrNumber: reserved } : {}),
          entryStatus: "draft",
        })
      );
      setDraftHint("Incomplete draft — continue editing, then Save.");
      return;
    }

    setDraftHint(
      readOnly
        ? null
        : lr?.entryStatus === "draft"
          ? "Incomplete draft — continue editing, then Save."
          : null
    );

    if (lr) {
      openedAsCreateRef.current = false;
      seededLrIdRef.current = lr.id;
      setValues(normalizeLrTextFields({ ...emptyLR, ...toEditableLR(lr) }));
      return;
    }

    openedAsCreateRef.current = true;
    seededLrIdRef.current = null;
    setValues(normalizeLrTextFields(emptyLR));

    let cancelled = false;

    getCompany()
      .then((company) => {
        if (cancelled || !company) return;
        // Seed default freight only — never show a fake next LR number.
        if (!readOnly && company.defaultFreightType) {
          setLrValues((current) => ({
            ...current,
            freightType: company.defaultFreightType,
          }));
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
    // setLrValues intentionally omitted — stable enough for open/lr/readOnly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lr, readOnly]);

  async function handleSave() {
    if (readOnly || checkingPo || loading) return;
    const fieldErrors = validateLR(values, { requireMaterialDescription });

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    // Recheck active selection at save; preserve unchanged historical snapshots.
    const mustCheckPo = requireMaterialDescription || values.customer !== lr?.customer
      || (values.purchaseOrderId ?? null) !== (lr?.purchaseOrderId ?? null);
    setCheckingPo(true);
    try {
      if (mustCheckPo) {
        const active = await getActiveLrPurchaseOrders(values.customer, values.consignor);
        if ((active.length > 0 || values.purchaseOrderId)
          && !active.some((po) => po.id === values.purchaseOrderId)) {
          toast.error("Choose an active PO for this billing party before saving.");
          return;
        }
      }
      setErrors({});
      await onSubmit({ ...values, entryStatus: "final" });
    } catch {
      toast.error("Unable to verify or save the PO selection. Please retry.");
    } finally { setCheckingPo(false); }
  }

  function handleCancel() {
    void requestDialogClose();
  }

  const title = readOnly
    ? "View Lorry Receipt"
    : isEditing
      ? "Edit Lorry Receipt"
      : "Create Lorry Receipt";

  const description = readOnly
    ? "LR details (read-only)."
    : "Enter shipment, vehicle and commercial details.";

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        void requestDialogClose();
      }}
      title={title}
      description={description}
      size="fullscreen"
      loading={loading || checkingPo}
      loadingText="Saving Lorry Receipt..."
      footer={
        readOnly ? (
          <>
            <Button variant="outline" onClick={handleCancel}>
              Close
            </Button>
            {onRequestContinueDraft ? (
              <Button onClick={onRequestContinueDraft}>Continue Draft</Button>
            ) : null}
            {onRequestEdit ? <Button onClick={onRequestEdit}>Edit</Button> : null}
          </>
        ) : (
          <>
            {draftHint ? (
              <p className="mr-auto text-xs text-muted-foreground">{draftHint}</p>
            ) : null}
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={loading || draftSaving}
            >
              Cancel
            </Button>

            {showSaveDraft ? (
              <Button
                variant="secondary"
                onClick={() => void handleSaveDraft()}
                disabled={loading || checkingPo || draftSaving || !hasMeaningfulDraft}
                title={
                  hasMeaningfulDraft
                    ? "Save as draft without finalizing"
                    : "Enter Consignor or Consignee to save a draft"
                }
              >
                {draftSaving ? "Saving Draft..." : "Save Draft"}
              </Button>
            ) : null}

            <Button onClick={handleSave} disabled={loading || checkingPo || draftSaving}>
              {loading ? "Saving..." : "Save LR"}
            </Button>
          </>
        )
      }
    >
      <LRForm
        lr={values}
        errors={errors}
        onChange={setLrValues}
        requireMaterialDescription={requireMaterialDescription}
        readOnly={readOnly}
        excludeLrId={lr?.id ?? null}
        notificationFocus={notificationFocus}
      />
    </FormDialog>
  );
}
