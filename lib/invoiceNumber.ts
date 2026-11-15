/** Bill (invoice) numbers in the Company Master format: prefix + zero-padded number. */
export function formatInvoiceNumber(value: number, config: { prefix: string; prefixLength: number }): string {
  return `${config.prefix}${String(value).padStart(config.prefixLength || 4, "0")}`;
}

/** The numeric part of a stored bill number in the company format, or null. */
export function invoiceNumberValue(billNumber: string, config: { prefix: string }): number | null {
  const digits = billNumber.trim().slice(config.prefix.length);
  return billNumber.trim().startsWith(config.prefix) && /^\d+$/.test(digits) ? Number(digits) : null;
}
