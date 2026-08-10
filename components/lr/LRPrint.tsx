import type { LRRecord } from "@/components/services/lr.service";
import type { CompanyRecord } from "@/components/services/company.service";
import styles from "./LRPrint.module.css";

interface LRPrintProps {
  lr: LRRecord;
  company: CompanyRecord | null;
}

/**
 * Replicates the approved LR book format exactly (see the reference PDF
 * shared for this task). Every field shown here maps 1:1 to an existing
 * `lr.schema.ts` / `company.schema.ts` field — no new data, no new
 * calculations. Text with no corresponding schema field (legal boilerplate:
 * ENDORSEMENT / CAUTION / NOTICE / Insurance block / Demurrage clause /
 * taglines) is reproduced as fixed template text, matching the reference
 * exactly, since there's nowhere else to source it from.
 */
export default function LRPrint({ lr, company }: LRPrintProps) {
  const companyName = company?.companyName || "";
  const address = [company?.address, company?.city, company?.pincode]
    .filter(Boolean)
    .join(", ");
  const cellNumbers = [company?.mobile, company?.alternateMobile]
    .filter(Boolean)
    .join(", ");
  const jurisdictionCity = (company?.city || "").toUpperCase();

  const packagesDisplay = lr.packages > 0 ? String(lr.packages) : "-";
  const rateDisplay = lr.billRate > 0 ? lr.billRate.toFixed(2) : "-";

  return (
    <div className={styles.page}>
      {/* ============ HEADER ============ */}
      <div className={styles.headerGrid}>
        {/* -------- LEFT -------- */}
        <div className={styles.headerLeft}>
          <div className={styles.gstinLine}>
            GSTIN: {company?.gstin || ""}
            <br />
            PAN No.: {company?.pan || ""}
          </div>

          <div className={styles.boxed}>
            <div className={styles.redHeading}>ENDORSEMENT</div>
            <div className={styles.blueText}>
              It is intended to use the CONSIGNEE COPY of this set for the
              purpose of borrowing from the consignee bank.
            </div>
          </div>

          <div>
            <div className={styles.blueHeading}>CAUTION</div>
            <div className={styles.blueText}>
              The consignment will not be detained diverted, re-routed re
              booked without consignee&apos;s bank written permission will be
              delivered at the destination.
            </div>
          </div>

          <div>
            <div className={styles.deliveryOfficeLabel}>
              Address of delivery office
            </div>
            <div className={styles.deliveryOfficeBox} />
          </div>

          <div className={styles.consignmentNoteBlock}>
            <div className={styles.consignmentNoteTitle}>CONSIGNMENT NOTE</div>
          </div>
          <div className={styles.lrNoLine}>No.: {lr.lrNumber}</div>
          <div className={styles.lrDateLine}>Date: {lr.lrDate}</div>
        </div>

        {/* -------- CENTER -------- */}
        <div className={styles.headerCenter}>
          <div className={styles.jurisdictionLine}>
            {jurisdictionCity
              ? `ALL SUBJECT TO ${jurisdictionCity} JURISDICTION ONLY`
              : "ALL SUBJECT TO COMPANY JURISDICTION ONLY"}
          </div>

          <div className={styles.companyBrand}>
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Company logo" className={styles.logoImg} />
            ) : (
              <div className={styles.logoPlaceholder}>LOGO</div>
            )}
            <div className={styles.companyName}>{companyName}</div>
          </div>

          <div className={styles.companyTagline}>Let your Success Ride with Us</div>
          <div className={styles.companySubtitle}>
            Transport Contractor &amp; Commission Agents all over India
          </div>
          <div className={styles.companyAddressLine}>H.O.: {address}</div>
          <div className={styles.companyAddressLine}>
            website : {company?.website || ""} &nbsp;&nbsp; E-mail: {company?.email || ""}
          </div>
          <div className={styles.companyCellLine}>Cell: {cellNumbers}</div>

          <div className={styles.ownerRiskHeading}>AT OWNER&apos;S RISK</div>
          <div className={styles.insuranceHeading}>INSURANCE</div>
          <div className={styles.insuranceBox}>
            <div className={styles.insuranceStatement}>
              The customer has stated that
              <br />
              He has Not Insured the consignment
            </div>
            <div className={styles.insuranceFieldRow}>
              <span>Company</span>
            </div>
            <div className={styles.insuranceFieldRow}>
              <span>Policy No.</span>
              <span>Date</span>
            </div>
            <div className={styles.insuranceFieldRow}>
              <span>Amount &nbsp; 0 INR</span>
              <span>Risk</span>
            </div>
          </div>
        </div>

        {/* -------- RIGHT -------- */}
        <div className={styles.headerRight}>
          <div className={styles.demurrageText}>
            Demurrage chargeable after 1 hour from today @ Rs 0
            <br />
            Per Hour per day Qtl. weight charged
          </div>

          <div className={styles.noticeBox}>
            <div className={styles.noticeHeading}>NOTICE</div>
            <div className={styles.noticeBody}>
              This Consignment covered by this set of Special Lorry Receipt
              From shall be stored at the destination under the control of
              the Transport Operator and shall be delivered to or to the
              order of the Consignee Bank whose name is mention circumstances
              be delivered to any one without the written authority from the
              Consignee Bank or its order endorsed on the Consigned Copy of
              on a separate Letter of Authority.
            </div>
          </div>

          <div className={styles.gstPayableHeading}>GST PAYABLE BY:</div>
          <div className={styles.gstPayableValue}>{lr.billingParty}</div>

          <div className={styles.driverBox}>
            <div className={styles.driverRow}>
              <span className={styles.driverRowLabel}>Driver Name:</span>
              <span>{lr.driverName}</span>
            </div>
            <div className={styles.driverRow}>
              <span className={styles.driverRowLabel}>Mo. No.:</span>
              <span>{lr.driverMobile}</span>
            </div>
            <div className={styles.driverRow}>
              <span className={styles.driverRowLabel}>Vehicle No.:</span>
              <span>{lr.vehicleNumber}</span>
            </div>
            <div className={styles.driverRow}>
              <span className={styles.driverRowLabel}>From:</span>
              <span>{lr.from}</span>
            </div>
            <div className={styles.driverRow}>
              <span className={styles.driverRowLabel}>To:</span>
              <span>{lr.to}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============ CONSIGNOR / CONSIGNEE ============ */}
      <div className={styles.partiesSection}>
        <span className={styles.partyLabel}>CONSIGNOR:</span>
        <span className={styles.partyValue}>{lr.consignor}</span>
        <span className={styles.partyGstLabel}>GST IN:</span>
        <span className={styles.partyGstValue}>{lr.consignorGST}</span>

        <span className={styles.addressLabel}>Address:</span>
        <span className={styles.addressValue}>{lr.consignorAddress}</span>

        <span className={styles.partyLabel}>CONSIGNEE:</span>
        <span className={styles.partyValue}>{lr.consignee}</span>
        <span className={styles.partyGstLabel}>GST IN:</span>
        <span className={styles.partyGstValue}>{lr.consigneeGST}</span>

        <span className={styles.addressLabel}>Address:</span>
        <span className={styles.addressValue}>{lr.consigneeAddress}</span>
      </div>

      {/* ============ MAIN TABLE ============ */}
      <table className={styles.mainTable}>
        <colgroup>
          <col className={styles.colPackages} />
          <col className={styles.colDescription} />
          <col className={styles.colWeight} />
          <col className={styles.colWeight} />
          <col className={styles.colRate} />
          <col className={styles.colFreight} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>Packages</th>
            <th rowSpan={2}>Description (Said to Contain)</th>
            <th colSpan={2}>Weight</th>
            <th rowSpan={2}>Rate</th>
            <th rowSpan={2}></th>
          </tr>
          <tr>
            <th>Actual</th>
            <th>Charged</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{packagesDisplay} {lr.packageType}</td>
            <td>
              {lr.material}
              <div className={styles.referenceBlock}>
                <div>Vendor Code : {lr.vendorCode}</div>
                <div>Invoice/DC No.: {lr.dcNumber || lr.invoiceNumber}</div>
                <div>Invoice/DC Date: {lr.dcDate || lr.invoiceDate}</div>
                <div>PO No. {lr.poNumber}</div>
              </div>
            </td>
            <td>{lr.loadingWeight.toFixed(3)} MT</td>
            <td>{lr.chargedWeight.toFixed(3)} MT</td>
            <td>{rateDisplay}</td>
            <td className={styles.freightCell}>Freight: {lr.freightType}</td>
          </tr>
        </tbody>
      </table>

      {/* ============ FOOTER ============ */}
      <div className={styles.footerRow}>
        <div>
          <div>
            <span className={styles.valueLabel}>Value</span> &nbsp;As per Invoice
          </div>
          <div className={styles.signatureLine} />
        </div>

        <div className={styles.signatureBlock}>
          <div className={styles.signatureLabel}>Consignor&apos;s Signature</div>
          <div className={styles.signatureLine} />
        </div>

        <div className={styles.transporterSignatureBlock}>
          <div className={styles.signatureLabel}>Signature of the Transporter</div>
          <div className={styles.signatureImagesWrap}>
            <div className={styles.signatureImagesRow}>
              {company?.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.signatureUrl} alt="Signature" className={styles.signatureImg} />
              )}
              {company?.stampUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.stampUrl} alt="Company stamp" className={styles.stampImg} />
              ) : (
                <div className={styles.stampPlaceholder}>STAMP</div>
              )}
            </div>
            <div className={styles.signatureLine} />
          </div>
        </div>
      </div>
    </div>
  );
}
