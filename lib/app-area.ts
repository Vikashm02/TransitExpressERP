/**
 * Application area helpers for TRANSPORT vs SUPPLIER shells.
 * Additive only — does not alter Transport route behavior.
 */

export type AppArea = "transport" | "supplier";

export const TRANSPORT_HOME = "/";
export const SUPPLIER_HOME = "/supplier/intelligence";

export function appAreaFromPathname(pathname: string | null | undefined): AppArea {
  const path = pathname ?? "";
  if (path === "/supplier" || path.startsWith("/supplier/")) {
    return "supplier";
  }
  return "transport";
}
