// The LR master's shape now lives in `lr.schema.ts` (single source of truth
// shared by validation and the TypeScript type). This file is kept so
// existing `@/components/lr/types` imports keep working, following the same
// convention as every other master module (Customer, Vehicle, Driver,
// Transporter, Material).
export type {
  LR,
  BillingParty,
  BillRateType,
  LorryHireType,
  FreightType,
  LRStatus,
} from "./lr.schema";
