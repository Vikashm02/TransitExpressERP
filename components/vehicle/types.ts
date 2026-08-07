// The Vehicle master's shape now lives in `vehicle.schema.ts` (single source
// of truth shared by validation and the TypeScript type). This file is kept
// so existing `@/components/vehicle/types` imports keep working.
export type { Vehicle, VehicleStatus, ComplianceStatus } from "./vehicle.schema";
