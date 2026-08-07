// The Material master's shape lives in `material.schema.ts` (single source
// of truth shared by validation and the TypeScript type). This file exists
// so `@/components/material/types` imports follow the same convention as
// every other master module (Customer, Vehicle, Driver, Transporter).
export type { Material, MaterialStatus } from "./material.schema";
