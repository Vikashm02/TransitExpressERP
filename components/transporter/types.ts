// The Transporter master's shape now lives in `transporter.schema.ts` (single
// source of truth shared by validation and the TypeScript type). This file is
// kept so existing `@/components/transporter/types` imports keep working.
export type {
  Transporter,
  TransporterType,
  PaymentTerm,
  PaymentMode,
  TransporterStatus,
} from "./transporter.schema";
