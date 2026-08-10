import type { LRRecord } from "@/components/services/lr.service";
import type { PodRecord } from "@/components/services/pod.service";

export interface BillingLine {
  /** false only for "Per Ton (Unloading)" LRs with no POD unloading weight yet. */
  ready: boolean;
  weight: number;
  rate: number;
  freight: number;
}

/**
 * Determines the billable Weight / Rate / Freight for an LR, per the four
 * Bill Rate Type rules:
 *
 *   - Fixed:              weight = Loading Weight (reference only, not used
 *                          in the calculation); freight = Bill Rate directly.
 *   - Per Ton (Loading):  freight = Loading Weight x Bill Rate.
 *   - Per Ton (Unloading): freight = POD Unloading Weight x Bill Rate.
 *                          Not "ready" until a POD with unloading weight
 *                          exists — never falls back to Loading Weight.
 *   - Guaranteed Weight:  freight = Bill Rate's own Guaranteed Weight x
 *                          Bill Rate (the LR's `guaranteedWeight` field,
 *                          never Lorry Hire's).
 *
 * Reads ONLY Bill Rate data (billRateType / billRate / loadingWeight /
 * guaranteedWeight) plus the linked POD's unloadingWeight. Intentionally
 * never reads lorryHireRate / lorryHireType / lorryHireGuaranteedWeight /
 * lorryHireAmount — the Billing module has zero dependency on Lorry Hire.
 */
export function computeBillingLine(lr: LRRecord, pod: PodRecord | undefined): BillingLine {
  const rate = lr.billRate;

  switch (lr.billRateType) {
    case "Fixed":
      return { ready: true, weight: lr.loadingWeight, rate, freight: rate };

    case "Per Ton (Loading)":
      return { ready: true, weight: lr.loadingWeight, rate, freight: lr.loadingWeight * rate };

    case "Per Ton (Unloading)": {
      const unloadingWeight = pod?.unloadingWeight ?? 0;

      if (unloadingWeight <= 0) {
        return { ready: false, weight: 0, rate, freight: 0 };
      }

      return { ready: true, weight: unloadingWeight, rate, freight: unloadingWeight * rate };
    }

    case "Guaranteed Weight":
      return {
        ready: true,
        weight: lr.guaranteedWeight,
        rate,
        freight: lr.guaranteedWeight * rate,
      };

    default:
      return { ready: false, weight: 0, rate, freight: 0 };
  }
}
