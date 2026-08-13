import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFPage,
} from "pdf-lib";
import { format, parseISO } from "date-fns";

import type { AsnRecord } from "@/components/services/asn.service";

/** Colours — restrained professional slate / dark blue. */
const C = {
  primary: rgb(0x1f / 255, 0x29 / 255, 0x37 / 255), // #1F2937
  secondary: rgb(0x6b / 255, 0x72 / 255, 0x80 / 255), // #6B7280
  accent: rgb(0x1f / 255, 0x4a / 255, 0x77 / 255), // #1F4A77
  sectionBg: rgb(0xf3 / 255, 0xf6 / 255, 0xf9 / 255), // #F3F6F9
  border: rgb(0xd9 / 255, 0xe1 / 255, 0xe8 / 255), // #D9E1E8
  white: rgb(1, 1, 1),
};

function fmtDate(value: string): string {
  if (!value) return "—";
  try {
    return format(parseISO(value.slice(0, 10)), "dd-MM-yyyy");
  } catch {
    return value;
  }
}

function fmtDateTime(value: string): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd-MM-yyyy HH:mm");
  } catch {
    return value;
  }
}

function fmtMt(value: number): string {
  return `${(Number(value) || 0).toFixed(3)} MT`;
}

/**
 * Return the exact stored public HTTPS attachment URL, or null if missing /
 * not a usable absolute https URL. Never rewrites host/path; only trims.
 */
function exactPublicHttpsUrl(stored: string | null | undefined): string | null {
  const url = String(stored ?? "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    // Reject non-openable schemes that may appear from browser-only state.
    if (
      url.startsWith("blob:") ||
      url.startsWith("http://localhost") ||
      url.startsWith("https://localhost") ||
      url.startsWith("/")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Filename from LR number: LR19192 / LR 19192 / 19192 → ASN19192.pdf
 * Single helper for print / download / share.
 */
export function asnPdfFileName(lrNumber: string): string {
  const stripped = String(lrNumber || "")
    .trim()
    .replace(/^LR\s*/i, "");
  return `ASN${stripped || "UNKNOWN"}.pdf`;
}

function addExternalUriLink(
  pdf: PDFDocument,
  page: PDFPage,
  absoluteHttpsUrl: string,
  x: number,
  yBaseline: number,
  textWidth: number,
  fontSize: number
) {
  // Text baseline ≈ glyph box; pad slightly for click target over "View".
  const padX = 1;
  const padY = 2;
  const llx = x - padX;
  const lly = yBaseline - padY;
  const urx = x + textWidth + padX;
  const ury = yBaseline + fontSize + padY;

  // Standard external URI link annotation pointing at the exact stored
  // Supabase public object URL (no rewrite).
  const action = pdf.context.obj({
    Type: "Action",
    S: "URI",
    URI: PDFString.of(absoluteHttpsUrl),
  });

  const link = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [llx, lly, urx, ury],
      Border: [0, 0, 0],
      C: [0x1f / 255, 0x4a / 255, 0x77 / 255],
      A: action,
    })
  );

  page.node.addAnnot(link);
}

/**
 * Clean unbranded ASN summary PDF (A4 portrait).
 * Clickable "View" links use absolute HTTPS Supabase public URLs.
 */
export async function generateAsnPdfBytes(asn: AsnRecord): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 44;
  const contentW = page.getWidth() - margin * 2;
  const labelX = margin + 12;
  const valueX = margin + 200;
  let y = page.getHeight() - 40;

  // Header bar
  page.drawRectangle({
    x: 0,
    y: page.getHeight() - 56,
    width: page.getWidth(),
    height: 56,
    color: C.sectionBg,
  });
  page.drawRectangle({
    x: 0,
    y: page.getHeight() - 56,
    width: 4,
    height: 56,
    color: C.accent,
  });
  page.drawText("ASN", {
    x: margin,
    y: page.getHeight() - 36,
    size: 20,
    font: bold,
    color: C.accent,
  });
  page.drawText("Advance Shipment Notice", {
    x: margin + 52,
    y: page.getHeight() - 34,
    size: 10,
    font,
    color: C.secondary,
  });
  y = page.getHeight() - 72;

  function section(title: string) {
    y -= 6;
    const bandH = 22;
    page.drawRectangle({
      x: margin,
      y: y - 6,
      width: contentW,
      height: bandH,
      color: C.sectionBg,
      borderColor: C.border,
      borderWidth: 0.6,
    });
    page.drawText(title, {
      x: labelX,
      y: y,
      size: 10,
      font: bold,
      color: C.accent,
    });
    y -= 28;
  }

  function row(label: string, value: string) {
    page.drawText(label, {
      x: labelX,
      y,
      size: 9.5,
      font,
      color: C.secondary,
    });
    const display = value?.trim() ? value : "—";
    page.drawText(display, {
      x: valueX,
      y,
      size: 9.5,
      font: bold,
      color: C.primary,
      maxWidth: page.getWidth() - valueX - margin,
    });
    y -= 16;
  }

  function attachmentRow(label: string, storedUrl: string) {
    page.drawText(label, {
      x: labelX,
      y,
      size: 9.5,
      font,
      color: C.secondary,
    });

    const publicUrl = exactPublicHttpsUrl(storedUrl);
    if (publicUrl) {
      const linkText = "View";
      const size = 9.5;
      const w = bold.widthOfTextAtSize(linkText, size);
      // Visible label only — never print the raw URL.
      page.drawText(linkText, {
        x: valueX,
        y,
        size,
        font: bold,
        color: C.accent,
      });
      page.drawLine({
        start: { x: valueX, y: y - 1 },
        end: { x: valueX + w, y: y - 1 },
        thickness: 0.7,
        color: C.accent,
      });
      addExternalUriLink(pdf, page, publicUrl, valueX, y, w, size);
    } else {
      page.drawText("Not attached", {
        x: valueX,
        y,
        size: 9.5,
        font,
        color: C.secondary,
      });
    }
    y -= 16;
  }

  section("ASN INFORMATION");
  row("ASN Number", asn.asnNumber);
  row("ASN Date", fmtDate(asn.asnDate));
  row("LR Number", asn.lrNumber);
  row("LR Date", fmtDate(asn.lrDate));

  section("VEHICLE & DRIVER");
  row("Vehicle Number", asn.vehicleNumber);
  row("Driver Name", asn.driverName);
  row("Driver Contact Number", asn.driverContact);

  section("WEIGHT & QUANTITY");
  row("Supplier Tare Weight", fmtMt(asn.supplierTareWeight));
  row("Supplier Net Weight", fmtMt(asn.supplierNetWeight));
  row("Supplier Gross Weight", fmtMt(asn.supplierGrossWeight));
  row("Challan Quantity", fmtMt(asn.challanQty));

  section("DOCUMENT INFORMATION");
  row("Challan / Invoice Number", asn.challanInvoiceNumber);
  row("Challan / Invoice Date", fmtDate(asn.challanInvoiceDate));
  row("Expected Time of Arrival", fmtDateTime(asn.expectedTimeOfArrival));
  row("Road Permit", asn.roadPermit);

  section("ATTACHMENTS");
  attachmentRow("Weightment Slip", asn.weightmentSlipUrl);
  attachmentRow("Challan Copy Slip", asn.challanCopySlipUrl);
  attachmentRow("LR Copy Slip", asn.lrCopySlipUrl);

  // Footer rule
  page.drawLine({
    start: { x: margin, y: 36 },
    end: { x: page.getWidth() - margin, y: 36 },
    thickness: 0.5,
    color: C.border,
  });
  page.drawText("ASN summary — document links open the uploaded files.", {
    x: margin,
    y: 22,
    size: 8,
    font,
    color: C.secondary,
  });

  return pdf.save({ useObjectStreams: false });
}

export async function generateAsnPdfFile(asn: AsnRecord): Promise<File> {
  const bytes = await generateAsnPdfBytes(asn);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], asnPdfFileName(asn.lrNumber), {
    type: "application/pdf",
  });
}
