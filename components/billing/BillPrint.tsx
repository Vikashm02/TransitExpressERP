import { format, parseISO } from "date-fns";

import type { BillRecord, BillLineRecord } from "@/components/services/billing.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { CompanyRecord } from "@/components/services/company.service";
import { amountInWords, countInWords } from "@/lib/numberToWords";
import { groupBillLines, plainNumber, printedBillNumber, rupees } from "./billPrintLayout";
import styles from "./BillPrint.module.css";

interface BillPrintProps {
  bill: BillRecord;
  billingParty: BillingPartyRecord | null;
  lines: BillLineRecord[];
  company: CompanyRecord | null;
}

/** GTA (road transport) HSN/SAC code — a fixed statutory constant, not
 * company-specific data, so there is nowhere else to source it from. */
const HSN_SAC_CODE = "996511";

function formatDate(value: string, pattern = "dd/MM/yyyy"): string {
  if (!value) return "";
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

/**
 * Tax Invoice in the approved landscape format ("CHANDA ACC BILL NO
 * 2475.pdf"): page 1 is the invoice with one row per same From +
 * Destination + Consignor + Rate; page 2 ("Details of Bill no") lists
 * every LR. Every value comes from the Bill, its lines (Weight/Rate/
 * Freight from `billingCalculations.ts`), the LR, the Billing Party or
 * the Company Master — nothing is recalculated here. Each page is a
 * `[data-bill-sheet]` so Share can put each on its own PDF page.
 */
export default function BillPrint({ bill, billingParty, lines, company }: BillPrintProps) {
  const companyName = company?.companyName || "";
  const address = [company?.address, company?.city, company?.pincode].filter(Boolean).join(", ");
  const jurisdictionCity = (company?.city || "").toUpperCase();
  const billNo = printedBillNumber(bill.billNumber);
  const summaryRows = groupBillLines(
    lines.map((line) => ({
      from: line.lr?.from ?? "",
      to: line.lr?.to ?? "",
      consignor: line.lr?.consignor ?? "",
      weight: line.weight,
      rate: line.rate,
      freight: line.freight,
    }))
  );
  const lrCount = String(lines.length).padStart(2, "0");

  return (
    <div className={styles.document}>
      {/* ================= PAGE 1 — TAX INVOICE ================= */}
      <div className={styles.sheet} data-bill-sheet="">
        <div className={styles.brandBlock}>
          {company?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="Company logo" className={styles.logoImg} crossOrigin="anonymous" />
          ) : null}
          <div className={styles.jurisdictionLine}>
            {jurisdictionCity
              ? `SUBJECT TO ${jurisdictionCity} JURISDICTION`
              : "SUBJECT TO COMPANY JURISDICTION"}
          </div>
          <div className={styles.companyName}>{companyName}</div>
          <div className={styles.companyAddressLine}>{address}</div>
          <div className={styles.companyContactLine}>
            Mob: {company?.mobile || ""} &nbsp; E-mail : <u>{company?.email || ""}</u>
            {company?.website ? <> {"//"} <u>{company.website}</u></> : null}
          </div>
          <div className={styles.panGstinLine}>
            PAN .NO :{company?.pan || ""} &nbsp;&nbsp;&nbsp;&nbsp; GSTIN : {company?.gstin || ""}
          </div>
        </div>

        <div className={styles.rule} />
        <div className={styles.taxInvoiceHeading}>TAX INVOICE</div>

        <div className={styles.metaGrid}>
          <div className={styles.partyBlock}>
            <div>M/S : {billingParty?.name || ""}</div>
            {billingParty?.address ? <div className={styles.preLine}>{billingParty.address}</div> : null}
            {billingParty?.city ? <div>{billingParty.city}</div> : null}
            <div className={styles.partyGstin}>
              <span className={styles.partyGstinLabel}>GSTIN :- </span>
              {billingParty?.gst || ""}
            </div>
          </div>

          <div className={styles.billMetaBlock}>
            <div><span className={styles.billMetaLabel}>BILL NO</span>: {billNo}</div>
            <div><span className={styles.billMetaLabel}>BILL DATE</span>: {formatDate(bill.billDate)}</div>
            <div><span className={styles.billMetaLabel}>P.O.NO</span>: {bill.poNumber}</div>
            <div><span className={styles.billMetaLabel}>HSN/SAC CODE</span>: {HSN_SAC_CODE}</div>
          </div>
        </div>

        <div className={styles.transportLine}>Transportation Charges of your materials under</div>

        <table className={`${styles.table} ${styles.summaryTable}`}>
          <thead>
            <tr>
              <th>SL NO</th>
              <th>FROM</th>
              <th>DESTINATION</th>
              <th>CONSIGNOR</th>
              <th>WEIGHT</th>
              <th>RATE PER MT</th>
              <th>FREIGHT</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((row, index) => (
              <tr key={`${row.from}|${row.to}|${row.consignor}|${row.rate}`}>
                <td>{index + 1}</td>
                <td>{row.from}</td>
                <td>{row.to}</td>
                <td>{row.consignor}</td>
                <td>{row.weight.toFixed(2)} &nbsp;MT</td>
                <td>{row.rate.toFixed(2)}</td>
                <td>{rupees(row.freight)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.totalsRow}>
          <div className={styles.notesBlock}>
            {billingParty?.vendorCode ? <div>Vendor Code : {billingParty.vendorCode}</div> : null}
            <div>As Per P.O. Copy Attached</div>
            <div>ENCL : DELIVERY CHALLAN</div>
            <div>GST IS PAYABLE BY YOU</div>
            <div className={styles.receiptsRow}>
              <span>Rto&nbsp; Penalty Receipt</span>
              <span>Unloading Receipts</span>
              <span>Union Receipts</span>
            </div>
          </div>

          <table className={styles.totalsTable}>
            <tbody>
              <tr><td>TOTAL:</td><td>{rupees(bill.totalFreight)}</td></tr>
              <tr><td>GST&nbsp; :</td><td>By Party</td></tr>
              <tr><td>GRAND TOTAL :</td><td>{rupees(bill.grandTotal)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className={styles.lrCountRow}>
          <span>No of Lrs. {lrCount}</span>
          <span>Total {countInWords(lines.length)}</span>
        </div>

        <div className={styles.amountInWordsRow}>TOTAL&nbsp; Rs: {amountInWords(bill.grandTotal)}</div>
        <div className={styles.rule} />
        <div className={styles.eoeLine}>E&amp;O.E</div>

        <div className={styles.certifyBox}>
          We hereby certify that we have not availed credit of Input Tax charged on Goods &amp; Services
          used in supplying the service under the provision of GST Act
          <span className={styles.certifyStrong}>
            . Tax is Payable on Reverse Charge: ( YES/NO ).In case there is any change in the above , we
            shall inform you of the same in writing on our own. We are registered under &ldquo;GTA BY
            ROAD&rdquo; and exempted from issuing E-Invoice.
          </span>
        </div>

        <div className={styles.signatureRow}>
          <div>Prepared By</div>
          <div>Checked By</div>
          <div className={styles.signatoryBlock}>
            <div className={styles.signatoryTitle}>Authorized Signatory</div>
            <div className={styles.signatureImagesRow}>
              {company?.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.signatureUrl} alt="Signature" className={styles.signatureImg} crossOrigin="anonymous" />
              )}
              {company?.stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.stampUrl} alt="Company stamp" className={styles.stampImg} crossOrigin="anonymous" />
              )}
            </div>
            <div className={styles.signatoryTitle}>{companyName}</div>
          </div>
        </div>
      </div>

      {/* ================= PAGE 2 — LR DETAILS ================= */}
      <div className={`${styles.sheet} ${styles.detailsSheet}`} data-bill-sheet="">
        <div className={styles.detailsHeading}>Details of Bill no &ndash; {billNo}</div>

        <table className={`${styles.table} ${styles.detailsTable}`}>
          <thead>
            <tr>
              <th>SL No</th>
              <th>LR NO</th>
              <th>LR DATE</th>
              <th>DC NO</th>
              <th>FROM</th>
              <th>CONSIGNEE</th>
              <th>DESTINATION</th>
              <th>VEHICLE NO.</th>
              <th>V.TYPE</th>
              <th>WEIGHT</th>
              <th>RATE PER MT</th>
              <th>FREIGHT</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id}>
                <td>{index + 1}</td>
                <td>{line.lr?.lrNumber ?? ""}</td>
                <td>{line.lr ? formatDate(line.lr.lrDate, "dd-MM-yyyy") : ""}</td>
                <td>{line.lr?.dcNumber ?? ""}</td>
                <td>{line.lr?.from ?? ""}</td>
                <td>{line.lr?.consignee ?? ""}</td>
                <td>{line.lr?.to ?? ""}</td>
                <td>{line.lr?.vehicleNumber ?? ""}</td>
                <td>{line.lr?.vehicleType ?? ""}</td>
                <td>{line.weight.toFixed(3)}</td>
                <td>{plainNumber(line.rate)}</td>
                <td>{plainNumber(line.freight)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9} />
              <td colSpan={2} className={styles.detailsTotalWeight}>
                TOTAL WT- {plainNumber(Math.round(bill.totalWeight * 1000) / 1000)} M.T
              </td>
              <td>{rupees(bill.totalFreight)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
