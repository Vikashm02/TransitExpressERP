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
type MaskBox = { x: number; y: number; w: number; h: number };

type FieldSpec = {
  /** Exact old-value glyph boxes only (never blank space / watermark / labels). */
  masks?: MaskBox[];
  /** @deprecated use masks — kept for single-box convenience via normalizeMasks */
  mask?: MaskBox;
  x: number;
  y: number;
  maxW: number;
  sizePt: number;
  bold?: boolean;
  color: "red" | "blue";
  wrap?: boolean;
  maxLines?: number;
  /**
   * Wrap fields only: vertically center the rendered line block inside the
   * existing mask-union text area (does not change mask geometry).
   */
  verticalCenter?: boolean;
  /** Description-only: wrap + optional pt shrink; never ellipsis. */
  descriptionWrap?: boolean;
  /** Max bottom Y (mm from page top) for wrapped description lines. */
  maxBottomY?: number;
  minSizePt?: number;
  /** Single-line: horizontally center within [x, x+maxW] (own column). */
  alignCenter?: boolean;
};

function normalizeMasks(spec: FieldSpec): MaskBox[] {
  if (spec.masks?.length) return spec.masks;
  if (spec.mask) return [spec.mask];
  return [];
}

/** Vertical extent of existing value masks (mm from page top). Masks unchanged. */
function textAreaFromMasks(masks: MaskBox[]): {
  top: number;
  bottom: number;
  height: number;
} | null {
  if (!masks.length) return null;
  const top = Math.min(...masks.map((m) => m.y));
  const bottom = Math.max(...masks.map((m) => m.y + m.h));
  return { top, bottom, height: bottom - top };
}

/**
 * Table vertical borders from lr-stationery.pdf (mm):
 * 4.128 | 34.837 | 115.526 | 145.81 | 176.095 | 206.38 | 292.787
 * Masks/text must stay ≥0.5mm inside these borders.
 */
const TABLE_V = {
  packagesRight: 34.837,
  descriptionRight: 115.526,
  actualRight: 145.81,
  chargedRight: 176.095,
  rateRight: 206.38,
} as const;
const BORDER_INSET = 0.5;

const FIELDS = {
  // Exact value glyphs from lr-stationery.pdf (LR 19175) — no blank-space pads.
  lrNumber: {
    masks: [{ x: 13.87, y: 71.36, w: 14.7, h: 4.93 }],
    x: 13.87,
    y: 71.36,
    maxW: 50,
    sizePt: 12.01,
    bold: true,
    color: "red" as const,
  },
  lrDate: {
    masks: [{ x: 16.64, y: 85.06, w: 19.66, h: 3.94 }],
    x: 16.64,
    y: 85.06,
    maxW: 40,
    sizePt: 9.61,
    color: "blue" as const,
  },
  gstPayable: {
    masks: [{ x: 233.28, y: 87.81, w: 17.74, h: 3.95 }],
    x: 233.28,
    y: 87.81,
    maxW: 50,
    sizePt: 9.61,
    color: "blue" as const,
  },
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
    masks: [{ x: 232.23, y: 107.3, w: 26.29, h: 3.94 }],
    x: 232.23,
    y: 107.3,
    maxW: 58,
    sizePt: 9.61,
    color: "blue" as const,
  },
  from: {
    masks: [{ x: 220.37, y: 113.23, w: 14.33, h: 3.94 }],
    x: 220.37,
    y: 113.23,
    maxW: 70,
    sizePt: 9.61,
    color: "blue" as const,
  },
  to: {
    masks: [{ x: 215.08, y: 119.16, w: 12.85, h: 3.94 }],
    x: 215.08,
    y: 119.16,
    maxW: 75,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consignor: {
    masks: [{ x: 35.9, y: 94.59, w: 52.39, h: 3.95 }],
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
    masks: [{ x: 35.9, y: 100.31, w: 112.87, h: 3.94 }],
    x: 35.9,
    y: 100.31,
    maxW: 168,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consignee: {
    // Two exact value lines — do not union into one wide/tall blank hole
    masks: [
      { x: 35.9, y: 106.03, w: 97.12, h: 3.94 },
      { x: 35.9, y: 110.05, w: 14.05, h: 3.95 },
    ],
    x: 35.9,
    y: 106.03,
    maxW: 98,
    sizePt: 9.61,
    color: "blue" as const,
    wrap: true,
    maxLines: 2,
    verticalCenter: true,
  },
  consigneeGST: {
    x: 151.0,
    y: 108.15,
    maxW: 52,
    sizePt: 9.61,
    color: "blue" as const,
  },
  consigneeAddress: {
    masks: [
      { x: 35.9, y: 115.77, w: 163.91, h: 3.94 },
      { x: 35.9, y: 119.79, w: 12.91, h: 3.95 },
    ],
    x: 35.9,
    y: 115.77,
    maxW: 168,
    sizePt: 9.61,
    color: "blue" as const,
    wrap: true,
    maxLines: 2,
    verticalCenter: true,
  },
  packages: {
    // Full packages-column interior so stationery sample "0" is cleared
    // when packageType is empty, and longer types fit without crossing
    // the Packages|Description divider (stay ≥0.5mm inside TABLE_V borders).
    masks: [
      {
        x: 4.128 + BORDER_INSET,
        y: 137.79,
        w: TABLE_V.packagesRight - BORDER_INSET - (4.128 + BORDER_INSET),
        h: 3.95,
      },
    ],
    x: 4.128 + BORDER_INSET,
    y: 137.79,
    maxW: TABLE_V.packagesRight - BORDER_INSET - (4.128 + BORDER_INSET),
    sizePt: 9.61,
    color: "blue" as const,
    // Same principle as Description: center within this column only.
    alignCenter: true,
  },
  material: {
    masks: [{ x: 49.03, y: 137.79, w: 52.59, h: 3.95 }],
    x: 36.0,
    y: 137.79,
    maxW: TABLE_V.descriptionRight - BORDER_INSET - 36.0,
    sizePt: 9.61,
    color: "blue" as const,
    descriptionWrap: true,
    maxBottomY: 158.5,
    minSizePt: 7.5,
  },
  vendorCode: {
    x: 63.2,
    y: 159.82,
    maxW: TABLE_V.descriptionRight - BORDER_INSET - 63.2,
    sizePt: 9.61,
    color: "blue" as const,
  },
  invoiceDcNo: {
    x: 65.4,
    y: 163.84,
    maxW: TABLE_V.descriptionRight - BORDER_INSET - 65.4,
    sizePt: 9.61,
    color: "blue" as const,
  },
  invoiceDcDate: {
    masks: [{ x: 68.53, y: 167.87, w: 19.66, h: 3.94 }],
    x: 68.53,
    y: 167.87,
    maxW: TABLE_V.descriptionRight - BORDER_INSET - 68.53,
    sizePt: 9.61,
    color: "blue" as const,
  },
  poNumber: {
    masks: [{ x: 49.66, y: 171.89, w: 21.53, h: 3.95 }],
    x: 49.66,
    y: 171.89,
    maxW: TABLE_V.descriptionRight - BORDER_INSET - 49.66,
    sizePt: 9.61,
    color: "blue" as const,
  },
  actualWeight: {
    masks: [{ x: 121.77, y: 137.79, w: 17.89, h: 3.95 }],
    x: 121.77,
    y: 137.79,
    maxW: TABLE_V.actualRight - BORDER_INSET - 121.77,
    sizePt: 9.61,
    color: "blue" as const,
  },
  chargedWeight: {
    masks: [{ x: 160.42, y: 137.79, w: 1.21, h: 3.95 }],
    x: 146.31,
    y: 137.79,
    maxW: TABLE_V.chargedRight - BORDER_INSET - 146.31,
    sizePt: 9.61,
    color: "blue" as const,
  },
  rate: {
    masks: [{ x: 190.71, y: 137.79, w: 1.21, h: 3.95 }],
    x: 176.6,
    y: 137.79,
    maxW: TABLE_V.rateRight - BORDER_INSET - 176.6,
    sizePt: 9.61,
    color: "blue" as const,
  },
  freightType: {
    masks: [{ x: 246.74, y: 149.23, w: 22.32, h: 3.94 }],
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

/**
 * PDF presentation only — never write this back to the database.
 * LR19305 | LR 19305 | 19305 → "LR 19305" (never "LR LR19305").
 */
function displayLrNumber(lrNumber: string): string {
  const stripped = String(lrNumber || "")
    .trim()
    .replace(/^LR\s*/i, "")
    .trim();
  if (!stripped) return "";
  return `LR ${stripped}`;
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

/** Truncate with ellipsis — only for non-description single-line fields. */
function fitSingleLine(text: string, font: PDFFont, sizePt: number, maxWidthPt: number): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, sizePt) <= maxWidthPt) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}…`, sizePt) > maxWidthPt) {
    t = t.slice(0, -1);
  }
  return t.length < text.length ? `${t}…` : t;
}

/**
 * Word-wrap using the same embedded font metrics. No ellipsis.
 * Returns null if content cannot fit in maxLines at this size.
 */
function wrapLinesNoEllipsis(
  text: string,
  font: PDFFont,
  sizePt: number,
  maxWidthPt: number,
  maxLines: number
): string[] | null {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    // Hard-break an overlong single word rather than spilling past the column.
    if (font.widthOfTextAtSize(word, sizePt) > maxWidthPt) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let chunk = "";
      for (const ch of word) {
        const next = chunk + ch;
        if (font.widthOfTextAtSize(next, sizePt) <= maxWidthPt) {
          chunk = next;
        } else {
          if (chunk) lines.push(chunk);
          chunk = ch;
          if (lines.length >= maxLines) return null;
        }
      }
      current = chunk;
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, sizePt) <= maxWidthPt) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) return null;
    }
  }
  if (current) {
    if (lines.length >= maxLines) return null;
    lines.push(current);
  }
  return lines.length <= maxLines ? lines : null;
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

/**
 * Value-tight white mask. Tiny vertical pad only — never expand horizontally
 * past the measured value box (avoids covering table borders).
 */
function maskRect(
  page: PDFPage,
  pageHeightPt: number,
  m: { x: number; y: number; w: number; h: number }
) {
  const padY = 0.08 * MM;
  const x = m.x * MM;
  const w = m.w * MM;
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

function drawDescription(
  page: PDFPage,
  pageHeightPt: number,
  font: PDFFont,
  spec: FieldSpec,
  value: string
) {
  for (const m of normalizeMasks(spec)) maskRect(page, pageHeightPt, m);
  const text = (value || "").trim();
  if (!text) return;

  const maxWpt = spec.maxW * MM;
  const color = colorOf(spec.color);
  const minSize = spec.minSizePt ?? 7.5;
  const maxBottomY = spec.maxBottomY ?? spec.y + 20;
  const startSize = spec.sizePt;

  let chosenSize = startSize;
  let chosenLines: string[] | null = null;

  for (let size = startSize; size >= minSize - 1e-6; size = Math.round((size - 0.25) * 100) / 100) {
    const leadingPt = size * 1.15;
    const leadingMm = leadingPt * (25.4 / 72);
    const maxLines = Math.max(1, Math.floor((maxBottomY - spec.y) / leadingMm));
    const lines = wrapLinesNoEllipsis(text, font, size, maxWpt, maxLines);
    if (lines) {
      chosenSize = size;
      chosenLines = lines;
      break;
    }
  }

  if (!chosenLines) {
    // Still too long at min size — draw what fits without ellipsis / without crossing column.
    const leadingPt = minSize * 1.15;
    const leadingMm = leadingPt * (25.4 / 72);
    const maxLines = Math.max(1, Math.floor((maxBottomY - spec.y) / leadingMm));
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, minSize) <= maxWpt) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
        if (lines.length >= maxLines) {
          current = "";
          break;
        }
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    chosenSize = minSize;
    chosenLines = lines;
  }

  // Top-aligned in the description band (spec.y → maxBottomY).
  // Each wrapped line is horizontally centered within spec.x + maxW.
  const bandH = chosenSize * (25.4 / 72);
  const baselineY = pageHeightPt - (spec.y + bandH * 0.9) * MM;
  const leading = chosenSize * 1.15;
  const originX = spec.x * MM;

  chosenLines.forEach((line, i) => {
    const lineWidth = font.widthOfTextAtSize(line, chosenSize);
    const lineX = originX + (maxWpt - lineWidth) / 2;
    page.drawText(line, {
      x: lineX,
      y: baselineY - i * leading,
      size: chosenSize,
      font,
      color,
      maxWidth: maxWpt,
    });
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
  if (spec.descriptionWrap) {
    drawDescription(page, pageHeightPt, font, spec, value);
    return;
  }

  const masks = normalizeMasks(spec);
  for (const m of masks) maskRect(page, pageHeightPt, m);
  const text = (value || "").trim();
  if (!text) return;

  const used = spec.bold ? boldFont : font;
  const maxWpt = spec.maxW * MM;
  const size = spec.sizePt;
  const color = colorOf(spec.color);
  const maskH = masks[0]?.h;
  const bandH =
    maskH && !spec.wrap
      ? Math.min(maskH, size * (25.4 / 72) * 1.15)
      : size * (25.4 / 72);
  const baselineY = pageHeightPt - (spec.y + bandH * 0.9) * MM;
  const leftX = spec.x * MM;

  if (spec.wrap) {
    const leadingPt = size * 1.18;
    const leadingMm = leadingPt * (25.4 / 72);
    const lineBoxMm = size * (25.4 / 72);
    const area = spec.verticalCenter ? textAreaFromMasks(masks) : null;

    // Capacity from existing mask-union height only — never expand the area.
    const capacity =
      area && leadingMm > 0
        ? Math.max(1, Math.floor((area.height - lineBoxMm) / leadingMm) + 1)
        : spec.maxLines ?? 2;
    const maxLines = Math.min(spec.maxLines ?? capacity, capacity);
    const lines = wrapLines(text, used, size, maxWpt, maxLines);

    let firstBaselineY = baselineY;
    if (area && lines.length > 0) {
      // blockHeight ≈ (n-1)*leading + one glyph box; center inside area.
      const blockH = (lines.length - 1) * leadingMm + lineBoxMm;
      let blockTop = area.top + (area.height - blockH) / 2;
      if (blockTop < area.top) blockTop = area.top;
      if (blockTop + blockH > area.bottom) blockTop = area.bottom - blockH;
      const firstBaselineMm = blockTop + lineBoxMm * 0.9;
      firstBaselineY = pageHeightPt - firstBaselineMm * MM;
    }

    lines.forEach((line, i) => {
      page.drawText(line, {
        x: leftX,
        y: firstBaselineY - i * leadingPt,
        size,
        font: used,
        color,
        maxWidth: maxWpt,
      });
    });
    return;
  }

  const fitted = fitSingleLine(text, used, size, maxWpt);
  if (spec.alignCenter) {
    // packagesLeft + (packagesColumnWidth - textWidth) / 2
    const textWidth = used.widthOfTextAtSize(fitted, size);
    page.drawText(fitted, {
      x: leftX + (maxWpt - textWidth) / 2,
      y: baselineY,
      size,
      font: used,
      color,
    });
    return;
  }

  page.drawText(fitted, {
    x: leftX,
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

  // Packages column shows package type (form field), not package count.
  const packagesValue = (lr.packageType || "").trim();

  const draws: Array<[FieldSpec, string]> = [
    [FIELDS.lrNumber, displayLrNumber(lr.lrNumber || "")],
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
    [FIELDS.material, (lr.materialDescription || "").trim() || lr.material || ""],
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

/**
 * Filename: LR19182 + MH12AB1234 → "LR 19182 - MH12AB1234.pdf".
 * LR number cleaning unchanged; vehicle is raw business data (omitted if empty).
 */
export function lrPdfFileName(
  lrNumber: string,
  vehicleNumber?: string | null
): string {
  const stripped = String(lrNumber || "")
    .trim()
    .replace(/^LR\s*/i, "");
  const vehicle = String(vehicleNumber || "").trim();
  if (vehicle) {
    return `LR ${stripped} - ${vehicle}.pdf`;
  }
  return `LR ${stripped}.pdf`;
}

export async function generateLrPdfFile(lr: LRRecord): Promise<File> {
  const template = await loadLrStationeryTemplate();
  const bytes = await generateLrPdfBytes(lr, template);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], lrPdfFileName(lr.lrNumber, lr.vehicleNumber), {
    type: "application/pdf",
  });
}
