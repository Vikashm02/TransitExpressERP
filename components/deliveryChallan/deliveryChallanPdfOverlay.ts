import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { format, parseISO } from "date-fns";

import type { DeliveryChallanRecord } from "@/components/services/deliveryChallan.service";

/** 1 mm in PDF points. */
const MM = 72 / 25.4;

/**
 * Dynamic text colour from CHALLAN 19179.pdf (all dynamic glyphs are black).
 * Measured via PyMuPDF span color = 0x000000.
 */
const COLOR_BLACK = rgb(0, 0, 0);

/**
 * Table vertical rules from delivery-challan-stationery.pdf (mm, page top-left):
 * 38.11 | 59.70 | 110.13 | 131.72 | 186.00 | 229.86
 */
const TABLE_V = {
  left: 38.11,
  snoRight: 59.7,
  descriptionRight: 110.13,
  qtyRight: 131.72,
  vehicleRight: 186.0,
  right: 229.86,
} as const;

/** Centre divider between Dispatch From / Dispatch To. */
const PARTY_DIVIDER_X = 131.72;
const BORDER_INSET = 0.5;

type MaskBox = { x: number; y: number; w: number; h: number };
type FontKind = "times" | "timesBold" | "calibri";

type FieldSpec = {
  masks?: MaskBox[];
  x: number;
  y: number;
  maxW: number;
  sizePt: number;
  font: FontKind;
  wrap?: boolean;
  maxLines?: number;
  /** Description column: wrap + optional pt shrink; never ellipsis. */
  descriptionWrap?: boolean;
  maxBottomY?: number;
  minSizePt?: number;
  /** Leading multiplier for wrapped lines (font-size relative). */
  leading?: number;
};

/**
 * Geometry measured from CHALLAN 19179.pdf (Letter landscape 279.4 × 215.9 mm).
 * Masks cover ONLY sample dynamic glyph boxes — never labels, borders, or logo.
 */
const FIELDS = {
  // Dispatch From name "RESSPL" (Calibri 9pt)
  consignor: {
    masks: [
      {
        x: 39.0,
        y: 67.61,
        w: PARTY_DIVIDER_X - BORDER_INSET - 39.0,
        h: 3.18,
      },
    ],
    x: 39.0,
    y: 67.61,
    maxW: PARTY_DIVIDER_X - BORDER_INSET - 39.0,
    sizePt: 9.0,
    font: "calibri" as const,
    wrap: true,
    maxLines: 1,
  },
  // Static "RE " remains (chars 38.996–43.016). Mask only the byName value.
  byName: {
    masks: [
      {
        x: 43.19,
        y: 72.61,
        w: PARTY_DIVIDER_X - BORDER_INSET - 43.19,
        h: 3.18,
      },
    ],
    x: 43.19,
    y: 72.61,
    maxW: PARTY_DIVIDER_X - BORDER_INSET - 43.19,
    sizePt: 9.0,
    font: "calibri" as const,
  },
  // Consignor address — line-slot masks at master Y (width = drawable half, not whole box)
  consignorAddress: {
    masks: [
      { x: 38.45, y: 80.53, w: PARTY_DIVIDER_X - BORDER_INSET - 38.45, h: 3.18 },
      { x: 38.45, y: 85.69, w: PARTY_DIVIDER_X - BORDER_INSET - 38.45, h: 3.18 },
      { x: 38.45, y: 90.85, w: PARTY_DIVIDER_X - BORDER_INSET - 38.45, h: 3.18 },
    ],
    x: 38.45,
    y: 80.53,
    maxW: PARTY_DIVIDER_X - BORDER_INSET - 38.45,
    sizePt: 9.0,
    font: "calibri" as const,
    wrap: true,
    maxLines: 3,
    maxBottomY: 99.5,
    // Master line starts: 80.53 / 85.69 / 90.85 → Δ 5.16 mm ≈ 1.625×9pt
    leading: 1.625,
  },
  // Static "GST: " remains; value after space at x=46.79
  consignorGst: {
    // Sample ends ~75.09; +1.2 mm covers full-Times glyph overflow
    masks: [{ x: 46.79, y: 100.74, w: 29.5, h: 3.52 }],
    x: 46.79,
    y: 100.74,
    maxW: PARTY_DIVIDER_X - BORDER_INSET - 46.79,
    sizePt: 9.0,
    font: "times" as const,
  },
  // Dispatch To name — two Times lines
  consignee: {
    masks: [
      {
        x: 132.61,
        y: 67.17,
        w: TABLE_V.right - BORDER_INSET - 132.61,
        h: 3.51,
      },
      {
        x: 132.61,
        y: 72.16,
        w: TABLE_V.right - BORDER_INSET - 132.61,
        h: 3.52,
      },
    ],
    x: 132.61,
    y: 67.17,
    maxW: TABLE_V.right - BORDER_INSET - 132.61,
    sizePt: 9.0,
    font: "times" as const,
    wrap: true,
    maxLines: 2,
    // Master line starts: 67.17 / 72.16 → Δ 4.99 mm ≈ 1.57×9pt
    leading: 1.57,
  },
  consigneeAddress: {
    masks: [
      {
        x: 132.61,
        y: 80.08,
        w: TABLE_V.right - BORDER_INSET - 132.61,
        h: 3.52,
      },
      {
        x: 132.61,
        y: 85.24,
        w: TABLE_V.right - BORDER_INSET - 132.61,
        h: 3.52,
      },
      {
        x: 132.61,
        y: 90.32,
        w: TABLE_V.right - BORDER_INSET - 132.61,
        h: 3.52,
      },
      {
        x: 132.61,
        y: 95.53,
        w: TABLE_V.right - BORDER_INSET - 132.61,
        h: 3.52,
      },
    ],
    x: 132.61,
    y: 80.08,
    maxW: TABLE_V.right - BORDER_INSET - 132.61,
    sizePt: 9.0,
    font: "times" as const,
    wrap: true,
    maxLines: 4,
    maxBottomY: 99.5,
    // Master line starts ≈ Δ 5.16 mm ≈ 1.625×9pt
    leading: 1.625,
  },
  consigneeGst: {
    masks: [{ x: 140.39, y: 100.74, w: 29.0, h: 3.52 }],
    x: 140.39,
    y: 100.74,
    maxW: TABLE_V.right - BORDER_INSET - 140.39,
    sizePt: 9.0,
    font: "times" as const,
  },
  // Static "LR DATE"; value "11.08.26"
  lrDate: {
    masks: [{ x: 65.92, y: 105.86, w: 12.2, h: 3.52 }],
    x: 65.92,
    y: 105.86,
    maxW: 40,
    sizePt: 9.0,
    font: "times" as const,
  },
  // Static "LR NO" + ": "; value "19179" only (after ": ")
  lrNumber: {
    masks: [{ x: 67.11, y: 119.12, w: 8.0, h: 2.72 }],
    x: 67.11,
    y: 119.12,
    maxW: 40,
    sizePt: 7.11,
    font: "times" as const,
  },
  // Static "PO" + "NO."; mask digit runs / wrap slots after "NO."
  poNumber: {
    masks: [
      { x: 137.73, y: 109.54, w: 40, h: 3.52 },
      { x: 132.61, y: 113.19, w: 45, h: 3.51 },
    ],
    x: 137.73,
    y: 109.54,
    maxW: TABLE_V.right - BORDER_INSET - 137.73,
    sizePt: 9.0,
    font: "times" as const,
    wrap: true,
    maxLines: 2,
    leading: 1.15,
  },
  // Static "PO DATE" + ":"; value "19.07.2025"
  poDate: {
    masks: [{ x: 150.73, y: 119.08, w: 13.5, h: 3.14 }],
    x: 150.73,
    y: 119.08,
    maxW: 40,
    sizePt: 8.19,
    font: "times" as const,
  },
  // Description line-slots in column 59.70–110.13 (never into QTY).
  description: {
    masks: [
      {
        x: 63.0,
        y: 130.04,
        w: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
        h: 3.14,
      },
      {
        x: 63.0,
        y: 133.77,
        w: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
        h: 3.14,
      },
      {
        x: 63.0,
        y: 137.5,
        w: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
        h: 3.14,
      },
      {
        x: 63.0,
        y: 141.23,
        w: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
        h: 3.14,
      },
      {
        x: 63.0,
        y: 144.96,
        w: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
        h: 3.14,
      },
      {
        x: 63.0,
        y: 148.69,
        w: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
        h: 3.14,
      },
    ],
    x: 63.0,
    y: 130.04,
    maxW: TABLE_V.descriptionRight - BORDER_INSET - 63.0,
    sizePt: 8.19,
    font: "times" as const,
    descriptionWrap: true,
    maxBottomY: 154.5,
    minSizePt: 6.5,
    // Master description lines Δ ≈ 3.73 mm ≈ 1.29×8.19pt
    leading: 1.29,
  },
  // QTY "29.060" Bold
  qty: {
    masks: [{ x: 110.47, y: 136.48, w: 7.76, h: 3.14 }],
    x: 110.47,
    y: 136.48,
    maxW: TABLE_V.qtyRight - BORDER_INSET - 110.47,
    sizePt: 8.04,
    font: "timesBold" as const,
  },
  // VEHICLE NO "CG08L 3982" Bold
  vehicleNumber: {
    masks: [{ x: 132.06, y: 136.48, w: 15.3, h: 3.14 }],
    x: 132.06,
    y: 136.48,
    maxW: TABLE_V.vehicleRight - BORDER_INSET - 132.06,
    sizePt: 8.04,
    font: "timesBold" as const,
  },
  // HSN "3915"
  hsn: {
    masks: [{ x: 186.33, y: 129.96, w: 5.65, h: 3.14 }],
    x: 186.33,
    y: 129.96,
    maxW: TABLE_V.right - BORDER_INSET - 186.33,
    sizePt: 8.04,
    font: "times" as const,
  },
} satisfies Record<string, FieldSpec>;

/** LR date as on master: 11.08.26 */
function formatLrDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd.MM.yy");
  } catch {
    return value;
  }
}

/** PO date as on master: 19.07.2025 */
function formatPoDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd.MM.yyyy");
  } catch {
    return value;
  }
}

function formatQty(value: number): string {
  if (!(value > 0)) return "";
  return value.toFixed(3);
}

function normalizeMasks(spec: FieldSpec): MaskBox[] {
  return spec.masks?.length ? spec.masks : [];
}

function pickFont(
  kind: FontKind,
  times: PDFFont,
  timesBold: PDFFont,
  calibri: PDFFont
): PDFFont {
  if (kind === "timesBold") return timesBold;
  if (kind === "calibri") return calibri;
  return times;
}

function fitSingleLine(
  text: string,
  font: PDFFont,
  sizePt: number,
  maxWidthPt: number
): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, sizePt) <= maxWidthPt) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t, sizePt) > maxWidthPt) {
    t = t.slice(0, -1);
  }
  return t;
}

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
  const fitted = wrapLinesNoEllipsis(text, font, sizePt, maxWidthPt, maxLines);
  if (fitted) return fitted;
  // Last resort: fit what we can without ellipsis / without crossing maxW.
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, sizePt) <= maxWidthPt) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = fitSingleLine(word, font, sizePt, maxWidthPt);
      if (lines.length >= maxLines) {
        current = "";
        break;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function maskRect(page: PDFPage, pageHeightPt: number, m: MaskBox) {
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
  const x = spec.x * MM;
  const minSize = spec.minSizePt ?? 6.5;
  const maxBottomY = spec.maxBottomY ?? spec.y + 20;
  const startSize = spec.sizePt;

  let chosenSize = startSize;
  let chosenLines: string[] | null = null;

  const leadFactor = spec.leading ?? 1.29;

  for (
    let size = startSize;
    size >= minSize - 1e-6;
    size = Math.round((size - 0.25) * 100) / 100
  ) {
    const leadingPt = size * leadFactor;
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
    const leadingPt = minSize * leadFactor;
    const leadingMm = leadingPt * (25.4 / 72);
    const maxLines = Math.max(1, Math.floor((maxBottomY - spec.y) / leadingMm));
    chosenSize = minSize;
    chosenLines = wrapLines(text, font, minSize, maxWpt, maxLines);
  }

  const bandH = chosenSize * (25.4 / 72);
  const baselineY = pageHeightPt - (spec.y + bandH * 0.88) * MM;
  const leading = chosenSize * leadFactor;

  chosenLines.forEach((line, i) => {
    page.drawText(line, {
      x,
      y: baselineY - i * leading,
      size: chosenSize,
      font,
      color: COLOR_BLACK,
      maxWidth: maxWpt,
    });
  });
}

function drawField(
  page: PDFPage,
  pageHeightPt: number,
  fonts: { times: PDFFont; timesBold: PDFFont; calibri: PDFFont },
  spec: FieldSpec,
  value: string
) {
  const font = pickFont(spec.font, fonts.times, fonts.timesBold, fonts.calibri);

  if (spec.descriptionWrap) {
    drawDescription(page, pageHeightPt, font, spec, value);
    return;
  }

  for (const m of normalizeMasks(spec)) maskRect(page, pageHeightPt, m);
  const text = (value || "").trim();
  if (!text) return;

  const maxWpt = spec.maxW * MM;
  const size = spec.sizePt;
  const masks = normalizeMasks(spec);
  const maskH = masks[0]?.h;
  const bandH =
    maskH && !spec.wrap
      ? Math.min(maskH, size * (25.4 / 72) * 1.15)
      : size * (25.4 / 72);
  const baselineY = pageHeightPt - (spec.y + bandH * 0.88) * MM;
  const x = spec.x * MM;

  if (spec.wrap) {
    const maxLines = spec.maxLines ?? 2;
    let lines: string[];
    if (spec.maxBottomY != null) {
      const leadingMm = size * (spec.leading ?? 1.15) * (25.4 / 72);
      const byBottom = Math.max(
        1,
        Math.floor((spec.maxBottomY - spec.y) / leadingMm)
      );
      lines = wrapLines(
        text,
        font,
        size,
        maxWpt,
        Math.min(maxLines, byBottom)
      );
    } else {
      lines = wrapLines(text, font, size, maxWpt, maxLines);
    }
    const leading = size * (spec.leading ?? 1.18);
    lines.forEach((line, i) => {
      page.drawText(line, {
        x,
        y: baselineY - i * leading,
        size,
        font,
        color: COLOR_BLACK,
        maxWidth: maxWpt,
      });
    });
    return;
  }

  page.drawText(fitSingleLine(text, font, size, maxWpt), {
    x,
    y: baselineY,
    size,
    font,
    color: COLOR_BLACK,
    maxWidth: maxWpt,
  });
}

async function loadFontBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Unable to load font ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Build a filled Delivery Challan PDF from CHALLAN 19179 stationery +
 * Delivery Challan (LR-snapshotted) values.
 */
export async function generateDeliveryChallanPdfBytes(
  challan: DeliveryChallanRecord,
  templateBytes: ArrayBuffer | Uint8Array,
  fontBytes?: {
    times?: Uint8Array;
    timesBold?: Uint8Array;
    calibri?: Uint8Array;
  }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes, {
    updateMetadata: false,
  });
  pdfDoc.registerFontkit(fontkit);

  // Master download sometimes includes a blank page 2 — drop it.
  while (pdfDoc.getPageCount() > 1) {
    pdfDoc.removePage(pdfDoc.getPageCount() - 1);
  }

  const page = pdfDoc.getPages()[0];
  const pageHeightPt = page.getHeight();

  const timesBytes =
    fontBytes?.times ??
    (await loadFontBytes("/delivery-challan/fonts/TimesNewRoman.ttf"));
  const timesBoldBytes =
    fontBytes?.timesBold ??
    (await loadFontBytes("/delivery-challan/fonts/TimesNewRoman-Bold.ttf"));
  const calibriBytes =
    fontBytes?.calibri ??
    (await loadFontBytes("/delivery-challan/fonts/Calibri.ttf"));

  const fonts = {
    times: await pdfDoc.embedFont(timesBytes),
    timesBold: await pdfDoc.embedFont(timesBoldBytes),
    calibri: await pdfDoc.embedFont(calibriBytes),
  };

  const draws: Array<[FieldSpec, string]> = [
    [FIELDS.consignor, challan.consignor || ""],
    [FIELDS.byName, challan.byName || ""],
    [FIELDS.consignorAddress, challan.consignorAddress || ""],
    [FIELDS.consignorGst, challan.consignorGst || ""],
    [FIELDS.consignee, challan.consignee || ""],
    [FIELDS.consigneeAddress, challan.consigneeAddress || ""],
    [FIELDS.consigneeGst, challan.consigneeGst || ""],
    [FIELDS.lrDate, formatLrDate(challan.lrDate || "")],
    [FIELDS.lrNumber, displayLrNumber(challan.lrNumber || "")],
    [FIELDS.poNumber, challan.poNumber || ""],
    [FIELDS.poDate, formatPoDate(challan.poDate || "")],
    [FIELDS.description, challan.description || ""],
    [FIELDS.qty, formatQty(challan.qty)],
    [FIELDS.vehicleNumber, challan.vehicleNumber || ""],
    [FIELDS.hsn, challan.hsn || ""],
  ];

  for (const [spec, value] of draws) {
    drawField(page, pageHeightPt, fonts, spec, value);
  }

  return pdfDoc.save({ useObjectStreams: false });
}

/** Master prints bare digits (19179); strip a leading "LR" for the value slot. */
function displayLrNumber(lrNumber: string): string {
  return String(lrNumber || "")
    .trim()
    .replace(/^LR\s*/i, "");
}

export async function loadDeliveryChallanStationeryTemplate(): Promise<ArrayBuffer> {
  const res = await fetch("/delivery-challan/delivery-challan-stationery.pdf");
  if (!res.ok) {
    throw new Error(
      "Unable to load Delivery Challan stationery template (CHALLAN 19179)."
    );
  }
  return res.arrayBuffer();
}

/** Filename: Delivery Challan 19179.pdf (no duplicated "LR"). */
export function deliveryChallanPdfFileName(lrNumber: string): string {
  const num = displayLrNumber(lrNumber);
  return `Delivery Challan ${num}.pdf`;
}

export async function generateDeliveryChallanPdfFile(
  challan: DeliveryChallanRecord
): Promise<File> {
  const template = await loadDeliveryChallanStationeryTemplate();
  const bytes = await generateDeliveryChallanPdfBytes(challan, template);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], deliveryChallanPdfFileName(challan.lrNumber), {
    type: "application/pdf",
  });
}
