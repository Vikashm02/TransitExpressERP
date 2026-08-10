import { format, parseISO } from "date-fns";

import type { BillRecord, BillLineRecord } from "@/components/services/billing.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { CompanyRecord } from "@/components/services/company.service";
import { amountInWords, countInWords } from "@/lib/numberToWords";
import styles from "./BillPrint.module.css";

interface BillPrintProps {
  bill: BillRecord;
  billingParty: BillingPartyRecord | null;
  lines: BillLineRecord[];
  company: CompanyRecord | null;
}

/** GTA (road transport) HSN/SAC code — a fixed statutory constant, not
 * company-specific data, so there is nowhere else to source it from (see
 * the reference PDF, "HSN/SAC CODE : 996511"). */
const HSN_SAC_CODE = "996511";

function formatDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd/MM/yyyy");
  } catch {
    return value;
  }
}

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * Replicates the approved Billing (Tax Invoice) format from the supplied
 * reference PDF ("ZIGMA BILL NO 2394.pdf"). Every field maps 1:1 to an
 * existing LR / Billing Party / Company Master field, or a per-line
 * Weight/Rate/Freight value already computed by `billingCalculations.ts`
 * — no new calculations happen in this component. Static legal/footer
 * text with no corresponding schema field is reproduced verbatim from the
 * reference, since there is nowhere else to source it from. The
 * "RATE PER MT" heading in the reference is deliberately shown as just
 * "RATE" here, since this table must also represent Fixed-rate LRs (a
 * flat amount, not a per-MT rate).
 */
export default function BillPrint({ bill, billingParty, lines, company }: BillPrintProps) {
  const companyName = company?.companyName || "";
  const address = [company?.address, company?.city, company?.pincode].filter(Boolean).join(", ");
  const jurisdictionCity = (company?.city || "").toUpperCase();

  return (
    <div className={styles.page}>
      {/* ============ HEADER ============ */}
      <div className={styles.jurisdictionLine}>
        {jurisdictionCity
          ? `SUBJECT TO ${jurisdictionCity} JURISDICTION`
          : "SUBJECT TO COMPANY JURISDICTION"}
      </div>

      <div className={styles.brandBlock}>
        {company?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="Company logo" className={styles.logoImg} />
        ) : (
          <div className={styles.logoPlaceholder}>LOGO</div>
        )}
        <div className={styles.companyName}>{companyName}</div>
        <div className={styles.companyAddressLine}>{address}</div>
        <div className={styles.companyContactLine}>
          Mob: {company?.mobile || ""} &nbsp;&nbsp; E-mail : {company?.email || ""}
          {company?.website ? <> &nbsp;//&nbsp; {company.website}</> : null}
        </div>
        <div className={styles.panGstinLine}>
          PAN NO :{company?.pan || ""}, GSTIN : {company?.gstin || ""}
        </div>
      </div>

      <div className={styles.rule} />
      <div className={styles.taxInvoiceHeading}>TAX INVOICE</div>
      <div className={styles.rule} />

      {/* ============ PARTY / BILL META ============ */}
      <div className={styles.metaGrid}>
        <div className={styles.partyBlock}>
          <div className={styles.partyName}>M/S : {billingParty?.name || ""}</div>
          <div>{billingParty?.address || ""}</div>
          <div>{billingParty?.city || ""}</div>
          <div className={styles.gstinHighlight}>GSTIN – {billingParty?.gst || ""}</div>
        </div>

        <div className={styles.billMetaBlock}>
          <div>
            <span className={styles.billMetaLabel}>BILL NO</span> : {bill.billNumber}
          </div>
          <div>
            <span className={styles.billMetaLabel}>BILL DATE</span> : {formatDate(bill.billDate)}
          </div>
          <div>
            <span className={styles.billMetaLabel}>PO NO</span> : {bill.poNumber}
          </div>
          <div>
            <span className={styles.billMetaLabel}>HSN/SAC CODE</span> : {HSN_SAC_CODE}
          </div>
        </div>
      </div>

      <div className={styles.transportLine}>Transportation Charges of your materials under</div>

      {/* ============ LR TABLE ============ */}
      <table className={styles.mainTable}>
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
            <th>RATE</th>
            <th>FREIGHT</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id}>
              <td className={styles.center}>{index + 1}</td>
              <td>{line.lr?.lrNumber ?? ""}</td>
              <td>{line.lr ? formatDate(line.lr.lrDate) : ""}</td>
              <td>{line.lr?.dcNumber ?? ""}</td>
              <td>{line.lr?.from ?? ""}</td>
              <td>{line.lr?.consignee ?? ""}</td>
              <td>{line.lr?.to ?? ""}</td>
              <td>{line.lr?.vehicleNumber ?? ""}</td>
              <td>{line.lr?.vehicleType ?? ""}</td>
              <td className={styles.right}>{line.weight.toFixed(2)}</td>
              <td className={styles.right}>{money(line.rate)}</td>
              <td className={styles.right}>{money(line.freight)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ============ TOTALS ============ */}
      <div className={styles.totalsRow}>
        <div className={styles.totalsLeft}>
          <div className={styles.gstPayableByLine}>GST IS PAYABLE BY YOU</div>
          <div className={styles.receiptCheckboxRow}>
            <span className={styles.checkboxBox} /> Rto Penalty Receipt
            <span className={styles.checkboxBox} /> Unloading Receipts
            <span className={styles.checkboxBox} /> Union Receipts
          </div>
        </div>

        <div className={styles.totalsRight}>
          <div>Total Qty : {bill.totalWeight.toFixed(2)} MT</div>
          <div>TOTAL : {money(bill.totalFreight)}/-</div>
          <div>GST : By Party</div>
          <div className={styles.grandTotalLine}>GRAND TOTAL : {money(bill.grandTotal)}/-</div>
        </div>
      </div>

      <div className={styles.lrCountRow}>
        <span>No of Lrs. {lines.length}</span>
        <span>Total {countInWords(lines.length)}</span>
      </div>

      <div className={styles.amountInWordsRow}>TOTALRS: {amountInWords(bill.grandTotal)}</div>

      {/* ============ FOOTER / SIGNATURE ============ */}
      <div className={styles.rule} />

      <div className={styles.eoeLine}>E&amp;O.E</div>
      <div className={styles.forCompanyLine}>For {companyName}.</div>

      <div className={styles.signatureRow}>
        <div className={styles.signatureBlock}>
          <div className={styles.signatureLine} />
          <div className={styles.signatureLabel}>Prepared By</div>
        </div>

        <div className={styles.signatureBlock}>
          <div className={styles.signatureLine} />
          <div className={styles.signatureLabel}>Checked By</div>
        </div>

        <div className={styles.signatureBlock}>
          <div className={styles.signatureImagesRow}>
            {company?.signatureUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.signatureUrl} alt="Signature" className={styles.signatureImg} />
            )}
            {company?.stampUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.stampUrl} alt="Company stamp" className={styles.stampImg} />
            )}
          </div>
          <div className={styles.signatureLine} />
          <div className={styles.signatureLabel}>Authorized Signatory</div>
        </div>
      </div>

      <div className={styles.legalText}>
        We hereby certify that we have not availed credit of Input Tax charged on Goods &amp;
        Services used in supplying the services under the provision of GST Act. Tax is Payable on
        Reverse Charge: ( YES/NO ). We are registered under &ldquo;GTA BY ROAD&rdquo; and exempted
        from issuing E-Invoice.
      </div>
    </div>
  );
}
