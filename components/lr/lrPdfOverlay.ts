import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { format, parseISO } from "date-fns";

import type { LRRecord } from "@/components/services/lr.service";

/** 1 mm in PDF points. */
const MM = 72 / 25.4;

/** Colours sampled from LR 19175.pdf dynamic text. */
const COLOR_RED = rgb(0xb6 / 255, 0x28 / 255, 0x25 / 255);
const COLOR_BLUE = rgb(0x1f / 255, 0x4a / 255, 0x77 / 255);

/**
 * Field geometry measured from `LR 19175.pdf` (page top-left origin, mm).
 * Masks cover ONLY example dynamic values — never static labels/lines/header art.
 */
type FieldSpec = {
  mask?: { x: number; y: number; w: number; h: number };
  x: number;
  y: number;
  maxW: number;
  sizePt: number;
  bold?: boolean;
  color: "red" | "blue";
  wrap?: boolean;
  maxLines?: number;
};

const FIELDS = {
  // No.: label static; value "19175" at (13.87, 71.36)
  lrNumber: {
    mask: { x: 13.87, y: 71.36, w: 50, h: 4.93 },
    x: 13.87,
    y: 71.36,
    maxW: 50,
    sizePt: 12.01,
    bold: true,
    color: "red" as const,
  },
  // Date: label static; value at (16.64, 85.06)
  lrDate: {
    mask: { x: 16.64, y: 85.06, w: 40, h: 3.95 },
    x: 16.64,
    y: 85.06,
    maxW: 40,
    sizePt: 9.61,
    color: "blue" as const,
  },
  // GST PAYABLE BY: label static; value "Consignee" at (233.28, 87.81)
  gstPayable: {
    mask: { x: 233.28, y: 87.81, w: 50, h: 3.95 },
    x: 233.28,
    y: 87.81,
    maxW: 50,
    sizePt: 9.61,
    color: "blue" as const,
  },
  // Driver values (right mid box) — labels static
  driverName: {
    x: 234.0,
    y: 95.44,
    maxW: 55,
    sizePt: 9.61,
    color: "blue" as const,
  },
  driverMobile: {
    x: 224.5,
    y: 101.37,
    maxW: 64,
    sizePt: 9.61,
    color: "blue" as const,
  },
  vehicleNumber: {
    mask: { x: 231.16, y: 107.3, w: 58, h: 3.95 },
    x: 231.16,
    y: 107.3,
    maxW: 58,
    sizePt: 9.61,
    color: "blue" as const,
  },
  from: {
    mask: { x: 219.3, y: 113.23, w: 70, h: 3.95 },
    x: 219.3,
    y: 113.23,
    maxW: 70,
    sizePt: 9.61,
    color: "blue" as const,
  },
  to: {
    mask: { x: 214.0, y: 119.16, w: 75, h: 3.95 },
    x: 214.0,
    y: 119.16,
    maxW: 75,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consignor: {
    mask: { x: 35.9, y: 94.59, w: 98, h: 3.95 },
    x: 35.9,
    y: 94.59,
    maxW: 98,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consignorGST: {
    x: 151.0,
    y: 94.59,
    maxW: 52,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consignorAddress: {
    mask: { x: 35.9, y: 100.31, w: 168, h: 3.95 },
    x: 35.9,
    y: 100.31,
    maxW: 168,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consignee: {
    mask: { x: 35.9, y: 106.03, w: 98, h: 8.0 },
    x: 35.9,
    y: 106.03,
    maxW: 98,
    sizePt: 9.61,
    color: "blue" as const,
    wrap: true,
    maxLines: 2,
  },
  consigneeGST: {
    x: 151.0,
    y: 108.15,
    maxW: 52,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consigneeAddress: {
    mask: { x: 35.9, y: 115.77, w: 168, h: 8.0 },
    x: 35.9,
    y: 115.77,
    maxW: 168,
    sizePt: 9.61,
    color: "blue" as const,
    wrap: true,
    maxLines: 2,
  },
  packages: {
    mask: { x: 13.45, y: 137.79, w: 30, h: 3.95 },
    x: 13.45,
    y: 137.79,
    maxW: 30,
    sizePt: 9.61,
    color: "blue" as const,
  },
  material: {
    mask: { x: 49.03, y: 137.79, w: 68, h: 3.95 },
    x: 49.03,
    y: 137.79,
    maxW: 68,
    sizePt: 9.61,
    color: "blue" as const,
  },
  vendorCode: {
    x: 63.2,
    y: 159.82,
    maxW: 55,
    sizePt: 9.61,
    color: "blue" as const,
  },
  invoiceDcNo: {
    x: 65.4,
    y: 163.84,
    maxW: 53,
    sizePt: 9.61,
    color: "blue" as const,
  },
  invoiceDcDate: {
    mask: { x: 68.53, y: 167.87, w: 40, h: 3.95 },
    x: 68.53,
    y: 167.87,
    maxW: 40,
    sizePt: 9.61,
    color: "blue" as const,
  },
  poNumber: {
    mask: { x: 49.66, y: 171.89, w: 55, h: 3.95 },
    x: 49.66,
    y: 171.89,
    maxW: 55,
    sizePt: 9.61,
    color: "blue" as const,
  },
  actualWeight: {
    mask: { x: 121.77, y: 137.79, w: 36, h: 3.95 },
    x: 121.77,
    y: 137.79,
    maxW: 36,
    sizePt: 9.61,
    color: "blue" as const,
  },
  chargedWeight: {
    mask: { x: 153.0, y: 137.79, w: 30, h: 3.95 },
    x: 160.42,
    y: 137.79,
    maxW: 28,
    sizePt: 9.61,
    color: "blue" as const,
  },
  rate: {
    mask: { x: 186.0, y: 137.79, w: 20, h: 3.95 },
    x: 186.9,
    y: 137.79,
    maxW: 20,
    sizePt: 9.61,
    color: "blue" as const,
  },
  // Static "Freight: " remains; mask only "To be billed"
  freightType: {
    mask: { x: 246.74, y: 149.23, w: 42, h: 3.95 },
    x: 246.74,
    y: 149.23,
    maxW: 42,
    sizePt: 9.61,
    bold: true,
    color: "blue" as const,
  },
} satisfies Record<string, FieldSpec>;

function formatPrintDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd-MM-yyyy");
  } catch {
    return value;
  }
}

function formatWeight(value: number): string {
  if (!(value > 0)) return "-";
  return `${value.toFixed(3)} MT`;
}

function formatRate(value: number): string {
  if (!(value > 0)) return "-";
  return value.toFixed(2);
}

function pickInvoiceDcNumber(lr: LRRecord): string {
  const dc = (lr.dcNumber || "").trim();
  if (dc) return dc;
  return (lr.invoiceNumber || "").trim();
}

function pickInvoiceDcDate(lr: LRRecord): string {
  const dc = (lr.dcDate || "").trim();
  if (dc) return formatPrintDate(dc);
  return formatPrintDate(lr.invoiceDate || "");
}

function colorOf(c: FieldSpec["color"]) {
  return c === "red" ? COLOR_RED : COLOR_BLUE;
}

function fitSingleLine(text: string, font: PDFFont, sizePt: number, maxWidthPt: number): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, sizePt) <= maxWidthPt) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}…`, sizePt) > maxWidthPt) {
    t = t.slice(0, -1);
  }
  return t.length < text.length ? `${t}…` : t;
}

function wrapLines(
  text: string,
  font: PDFFont,
  sizePt: number,
  maxWidthPt: number,
  maxLines: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, sizePt) <= maxWidthPt) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.map((line, i) =>
    i === maxLines - 1 ? fitSingleLine(line, font, sizePt, maxWidthPt) : line
  );
}

function maskRect(
  page: PDFPage,
  pageHeightPt: number,
  m: { x: number; y: number; w: number; h: number }
) {
  const padX = 0.2 * MM;
  const padY = 0.1 * MM;
  const x = m.x * MM - padX;
  const w = m.w * MM + padX * 2;
  const topPt = pageHeightPt - m.y * MM + padY;
  const h = m.h * MM + padY * 2;
  page.drawRectangle({
    x,
    y: topPt - h,
    width: w,
    height: h,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
}

function drawField(
  page: PDFPage,
  pageHeightPt: number,
  font: PDFFont,
  boldFont: PDFFont,
  spec: FieldSpec,
  value: string
) {
  if (spec.mask) maskRect(page, pageHeightPt, spec.mask);
  const text = (value || "").trim();
  if (!text) return;

  const used = spec.bold ? boldFont : font;
  const maxWpt = spec.maxW * MM;
  const size = spec.sizePt;
  const color = colorOf(spec.color);
  const bandH = spec.mask?.h && !spec.wrap ? Math.min(spec.mask.h, size * (25.4 / 72) * 1.15) : size * (25.4 / 72);
  const baselineY = pageHeightPt - (spec.y + bandH * 0.9) * MM;
  const x = spec.x * MM;

  if (spec.wrap) {
    const lines = wrapLines(text, used, size, maxWpt, spec.maxLines ?? 2);
    const leading = size * 1.18;
    lines.forEach((line, i) => {
      page.drawText(line, {
        x,
        y: baselineY - i * leading,
        size,
        font: used,
        color,
        maxWidth: maxWpt,
      });
    });
    return;
  }

  page.drawText(fitSingleLine(text, used, size, maxWpt), {
    x,
    y: baselineY,
    size,
    font: used,
    color,
    maxWidth: maxWpt,
  });
}

async function loadFontBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Unable to load font ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Build a filled LR PDF from LR 19175 production stationery + LR Entry values.
 * Static pixels outside measured dynamic masks are preserved from the template.
 */
export async function generateLrPdfBytes(
  lr: LRRecord,
  templateBytes: ArrayBuffer | Uint8Array,
  fontRegularBytes?: Uint8Array,
  fontBoldBytes?: Uint8Array
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes, {
    updateMetadata: false,
  });
  pdfDoc.registerFontkit(fontkit);

  const page = pdfDoc.getPages()[0];
  const pageHeightPt = page.getHeight();

  const regularBytes =
    fontRegularBytes ?? (await loadFontBytes("/lr-stationery/fonts/Arial.ttf"));
  const boldBytes =
    fontBoldBytes ?? (await loadFontBytes("/lr-stationery/fonts/Arial-Bold.ttf"));

  const font = await pdfDoc.embedFont(regularBytes);
  const boldFont = await pdfDoc.embedFont(boldBytes);

  const packagesValue =
    lr.packages === null || lr.packages === undefined ? "" : String(lr.packages);

  const draws: Array<[FieldSpec, string]> = [
    [FIELDS.lrNumber, lr.lrNumber || ""],
    [FIELDS.lrDate, formatPrintDate(lr.lrDate || "")],
    [FIELDS.gstPayable, lr.billingParty || ""],
    [FIELDS.driverName, lr.driverName || ""],
    [FIELDS.driverMobile, lr.driverMobile || ""],
    [FIELDS.vehicleNumber, lr.vehicleNumber || ""],
    [FIELDS.from, lr.from || ""],
    [FIELDS.to, lr.to || ""],
    [FIELDS.consignor, lr.consignor || ""],
    [FIELDS.consignorGST, lr.consignorGST || ""],
    [FIELDS.consignorAddress, lr.consignorAddress || ""],
    [FIELDS.consignee, lr.consignee || ""],
    [FIELDS.consigneeGST, lr.consigneeGST || ""],
    [FIELDS.consigneeAddress, lr.consigneeAddress || ""],
    [FIELDS.packages, packagesValue],
    [FIELDS.material, lr.material || ""],
    [FIELDS.vendorCode, lr.vendorCode || ""],
    [FIELDS.invoiceDcNo, pickInvoiceDcNumber(lr)],
    [FIELDS.invoiceDcDate, pickInvoiceDcDate(lr)],
    [FIELDS.poNumber, lr.poNumber || ""],
    [FIELDS.actualWeight, formatWeight(lr.loadingWeight)],
    [FIELDS.chargedWeight, formatWeight(lr.chargedWeight)],
    [FIELDS.rate, formatRate(lr.billRate)],
    [FIELDS.freightType, lr.freightType || ""],
  ];

  for (const [spec, value] of draws) {
    drawField(page, pageHeightPt, font, boldFont, spec, value);
  }

  return pdfDoc.save({ useObjectStreams: false });
}

export async function loadLrStationeryTemplate(): Promise<ArrayBuffer> {
  const res = await fetch("/lr-stationery/lr-stationery.pdf");
  if (!res.ok) {
    throw new Error("Unable to load LR stationery template (LR 19175).");
  }
  return res.arrayBuffer();
}

/** Filename: LR19182 → "LR 19182.pdf" (display number unchanged). */
export function lrPdfFileName(lrNumber: string): string {
  const stripped = String(lrNumber || "")
    .trim()
    .replace(/^LR\s*/i, "");
  return `LR ${stripped}.pdf`;
}

export async function generateLrPdfFile(lr: LRRecord): Promise<File> {
  const template = await loadLrStationeryTemplate();
  const bytes = await generateLrPdfBytes(lr, template);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], lrPdfFileName(lr.lrNumber), { type: "application/pdf" });
}
