/** Weights are metric tons throughout the ERP. Status is always manual. */
export function purchaseOrderUsage(allotted: number, used: number) {
  const percent = allotted > 0 ? (used / allotted) * 100 : 0;
  return {
    percent,
    remaining: allotted - used,
    exceeded: Math.max(0, used - allotted),
    warning: percent > 90 ? "red" : percent >= 80 ? "yellow" : "none",
  } as const;
}

export function purchaseOrderWarningClass(allotted: number, used: number) {
  const { warning } = purchaseOrderUsage(allotted, used);
  if (warning === "red") return "bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100";
  if (warning === "yellow") return "bg-yellow-50 text-yellow-950 dark:bg-yellow-950/40 dark:text-yellow-100";
  return "";
}
