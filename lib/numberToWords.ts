/**
 * Converts a non-negative number into words using the Indian numbering
 * system (Thousand / Lakh / Crore), for the Billing module's "Amount in
 * Words" / "Number of LRs in words" fields. Pure utility — no dependency
 * on any domain schema.
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigitsToWords(value: number): string {
  if (value < 20) return ONES[value];

  const tens = Math.floor(value / 10);
  const ones = value % 10;

  return ones ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens];
}

function threeDigitsToWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;

  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (remainder) parts.push(twoDigitsToWords(remainder));

  return parts.join(" ");
}

/** Whole-number part only (Indian grouping: last 3 digits, then pairs of 2). */
function integerToWords(value: number): string {
  if (value === 0) return "Zero";

  const crore = Math.floor(value / 1_00_00_000);
  const lakh = Math.floor((value % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((value % 1_00_000) / 1_000);
  const hundred = value % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitsToWords(hundred));

  return parts.join(" ");
}

/** e.g. 1085733 -> "Ten Lakh Eighty-Five Thousand Seven Hundred Thirty-Three". */
export function numberToWords(value: number): string {
  const rounded = Math.round(Math.abs(value));
  return integerToWords(rounded);
}

/** e.g. 1085733 -> "Ten Lakh Eighty-Five Thousand Seven Hundred Thirty-Three Only." */
export function amountInWords(value: number): string {
  return `${numberToWords(value)} Only.`;
}

/** e.g. 21 -> "Twenty-One Nos. Only." */
export function countInWords(value: number): string {
  return `${numberToWords(value)} Nos. Only.`;
}
