// The Customer master's shape now lives in `customer.schema.ts` (single
// source of truth shared by validation and the TypeScript type). This file
// is kept so existing `@/components/customer/types` imports keep working.
export type { Customer, CustomerStatus } from "./customer.schema";
