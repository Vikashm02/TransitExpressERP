import { format, parseISO } from "date-fns";

import type { LRRecord } from "@/components/services/lr.service";
import type { CompanyRecord } from "@/components/services/company.service";
import styles from "./LRPrint.module.css";

interface LRPrintProps {
  lr: LRRecord;
  company: CompanyRecord | null;
}

/** Stationery date format used on filled reference LRs (e.g. 12-08-2026). */
function formatPrintDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd-MM-yyyy");
  } catch {
    return value;
  }
}

/**
 * A4-landscape Consignment Note stationery.
 * Geometry measured from `LR sample.pdf` (page-absolute mm).
 * Dynamic fields map 1:1 to LR Entry / billing party.
 */
export default function LRPrint({ lr, company }: LRPrintProps) {
  const companyName = company?.companyName || "TRANS-JIT EXPRESS";
  const address = [company?.address, company?.city, company?.pincode]
    .filter(Boolean)
    .join(", ");
  const cellNumbers = [company?.mobile, company?.alternateMobile]
    .filter(Boolean)
    .join(", ");
  const jurisdictionCity = (company?.city || "VISAKHAPATNAM").toUpperCase();
  // Master header mark only — never the purple website logo.
  const logoSrc = "/lr-stationery/header-mark.png";
  // Company assets preferred; otherwise exact artwork extracted from LR sample.pdf.
  const signatureSrc =
    company?.signatureUrl || "/lr-stationery/consignor-signature.png";
  const stampSrc = company?.stampUrl || "/lr-stationery/transport-stamp.png";

  const packagesDisplay = lr.packages > 0 ? String(lr.packages) : "-";
  const rateDisplay = lr.billRate > 0 ? lr.billRate.toFixed(2) : "-";
  const actualWeightDisplay =
    lr.loadingWeight > 0 ? `${lr.loadingWeight.toFixed(3)} MT` : "-";
  const chargedWeightDisplay =
    lr.chargedWeight > 0 ? `${lr.chargedWeight.toFixed(3)} MT` : "-";
  const invoiceDcNumber = lr.dcNumber || lr.invoiceNumber;
  const invoiceDcDate = formatPrintDate(lr.dcDate || lr.invoiceDate);

  return (
    <div className={styles.page}>
      <div className={styles.stationery}>
        {/* ===== LEFT ===== */}
        <div className={styles.gstinPan}>
          GSTIN: {company?.gstin || ""}
          <br />
          PAN No.: {company?.pan || ""}
        </div>

        <div className={styles.endorsementBox}>
          <div className={styles.endorsementTitle}>ENDORSEMENT</div>
          <div className={styles.endorsementBody}>
            It is intended to use the CONSIGNEE COPY of this set for the
            <br />
            purpose of borrowing from the consignee bank.
          </div>
        </div>

        <div className={styles.cautionTitle}>CAUTION</div>
        <div className={styles.cautionBody}>
          The consignment will not be detained diverted, re-routed re booked
          <br />
          without consignee&apos;s bank written permission will be delivered at the
          <br />
          destination.
        </div>

        <div className={styles.deliveryLabel}>Address of delivery office</div>
        <div className={styles.deliveryBox} />

        <div className={styles.consignmentNoteRuleTop} />
        <div className={styles.consignmentNote}>CONSIGNMENT NOTE</div>
        <div className={styles.consignmentNoteRuleBottom} />
        <div className={styles.lrNumber}>No.: {lr.lrNumber}</div>
        <div className={styles.lrDate}>Date: {formatPrintDate(lr.lrDate)}</div>

        {/* ===== CENTER ===== */}
        <div className={styles.jurisdiction}>
          ALL SUBJECT TO {jurisdictionCity} JURISDICTION ONLY
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="" className={styles.headerMark} />
        <div className={styles.companyName}>{companyName}</div>
        <div className={styles.tagline}>Let your Success Ride with Us</div>
        <div className={styles.subtitle}>
          Transport Contractor &amp; Commission Agents all over India
        </div>
        <div className={styles.addressLine}>H.O.: {address}</div>
        <div className={styles.webLine}>
          website : {company?.website || ""} &nbsp;&nbsp; E-mail:{" "}
          {company?.email || ""}
        </div>
        <div className={styles.cellLine}>Cell: {cellNumbers}</div>

        <div className={styles.ownerRisk}>AT OWNER&apos;S RISK</div>
        <div className={styles.ownerRiskRule} />
        <div className={styles.insuranceTitle}>INSURANCE</div>
        <div className={styles.insuranceBox}>
          <div className={styles.insuranceStatement}>
            The customer has stated that
            <br />
            He has Not Insured the consignment
          </div>
          <div className={styles.insuranceCompany}>Company</div>
          <div className={styles.insurancePolicy}>Policy No.</div>
          <div className={styles.insuranceDate}>Date</div>
          <div className={styles.insuranceAmount}>Amount &nbsp; 0 INR</div>
          <div className={styles.insuranceRisk}>Risk</div>
        </div>

        {/* ===== RIGHT ===== */}
        <div className={styles.demurrage}>
          Demurrage chargeable after 1 hour from today @ Rs 0
          <br />
          Per Hour per day Qtl. weight charged
        </div>

        <div className={styles.noticeBox}>
          <div className={styles.noticeTitle}>NOTICE</div>
          <div className={styles.noticeBody}>
            This Consignment covered by this set of Special Lorry Receipt From
            shall be stored at the destination under
            <br />
            control of the Transport Operator and shall be delivered to or to
            the order of the Consignee Bank whose nam
            <br />
            mention circumstances be delivered to any one without the written
            authority from the Consignee Bank or its
            <br />
            order endorsed on the Consigned Copy of on a separate Letter of
            Authority.
          </div>
        </div>

        <div className={styles.gstPayableLabel}>GST PAYABLE BY:</div>
        <div className={styles.gstPayableValue}>{lr.billingParty}</div>

        <div className={styles.driverBox}>
          <div className={`${styles.driverRow} ${styles.driverRow1}`}>
            <span className={styles.driverLabel}>Driver Name:</span>
            {" "}{lr.driverName}
          </div>
          <div className={styles.driverRule1} />
          <div className={`${styles.driverRow} ${styles.driverRow2}`}>
            <span className={styles.driverLabel}>Mo. No.:</span>
            {" "}{lr.driverMobile}
          </div>
          <div className={styles.driverRule2} />
          <div className={`${styles.driverRow} ${styles.driverRow3}`}>
            <span className={styles.driverLabel}>Vehicle No.:</span>
            {" "}{lr.vehicleNumber}
          </div>
          <div className={styles.driverRule3} />
          <div className={`${styles.driverRow} ${styles.driverRow4}`}>
            <span className={styles.driverLabel}>From:</span>
            {" "}{lr.from}
          </div>
          <div className={styles.driverRule4} />
          <div className={`${styles.driverRow} ${styles.driverRow5}`}>
            <span className={styles.driverLabel}>To:</span>
            {" "}{lr.to}
          </div>
        </div>

        {/* ===== PARTIES ===== */}
        <div className={styles.consignorLabel}>CONSIGNOR:</div>
        <div className={styles.consignorName}>{lr.consignor}</div>
        <div className={styles.consignorGstLabel}>GST IN:</div>
        <div className={styles.consignorGstValue}>{lr.consignorGST}</div>
        <div className={styles.consignorGstRule} />
        <div className={styles.consignorAddressLabel}>Address:</div>
        <div className={styles.consignorAddressValue}>{lr.consignorAddress}</div>

        <div className={styles.consigneeLabel}>CONSIGNEE:</div>
        <div className={styles.consigneeName}>{lr.consignee}</div>
        <div className={styles.consigneeGstLabel}>GST IN:</div>
        <div className={styles.consigneeGstValue}>{lr.consigneeGST}</div>
        <div className={styles.consigneeGstRule} />
        <div className={styles.consigneeAddressLabel}>Address:</div>
        <div className={styles.consigneeAddressValue}>{lr.consigneeAddress}</div>

        {/* ===== TABLE ===== */}
        <table className={styles.itemTable}>
          <colgroup>
            <col style={{ width: "22.86mm" }} />
            <col style={{ width: "81.60mm" }} />
            <col style={{ width: "30.37mm" }} />
            <col style={{ width: "30.66mm" }} />
            <col style={{ width: "22.86mm" }} />
            <col style={{ width: "96.62mm" }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Packages</th>
              <th rowSpan={2}>Description (Said to Contain)</th>
              <th colSpan={2}>Weight</th>
              <th rowSpan={2}>Rate</th>
              <th rowSpan={2} />
            </tr>
            <tr>
              <th>Actual</th>
              <th>Charged</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {packagesDisplay} {lr.packageType}
              </td>
              <td>
                <div>{(lr.materialDescription || "").trim() || lr.material}</div>
                <div className={styles.refLines}>
                  <div>Vendor Code : {lr.vendorCode}</div>
                  <div>Invoice/DC No.: {invoiceDcNumber}</div>
                  <div>Invoice/DC Date: {invoiceDcDate}</div>
                  <div>PO No. {lr.poNumber}</div>
                </div>
              </td>
              <td>{actualWeightDisplay}</td>
              <td>{chargedWeightDisplay}</td>
              <td>{rateDisplay}</td>
              <td className={styles.freightCell}>Freight: {lr.freightType}</td>
            </tr>
          </tbody>
        </table>

        {/* ===== FOOTER ===== */}
        <div className={styles.footerValueLabel}>Value</div>
        <div className={styles.footerValueText}>&nbsp;As per Invoice</div>
        <div className={styles.footerConsignor}>Consignor&apos;s Signature</div>
        <div className={styles.footerTransporter}>Signature of the Transporter</div>
        <div className={styles.sigLineLeft} />
        <div className={styles.sigLineCenter} />
        <div className={styles.sigLineRight} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={signatureSrc} alt="" className={styles.sigImg} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={stampSrc} alt="" className={styles.stampImg} />
      </div>
    </div>
  );
}
