// The Driver master's shape now lives in `driver.schema.ts` (single source
// of truth shared by validation and the TypeScript type). This file is kept
// so existing `@/components/driver/types` imports keep working.
export type { Driver, DriverType, DriverStatus, LicenseStatus } from "./driver.schema";
