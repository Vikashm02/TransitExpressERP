import { format, parseISO } from "date-fns";

import type { DeliveryChallanRecord } from "@/components/services/deliveryChallan.service";
import styles from "./DeliveryChallanPrint.module.css";

interface DeliveryChallanPrintProps {
  challan: DeliveryChallanRecord;
}

/** LR date as shown on the reference: 11.08.26 */
function formatLrDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd.MM.yy");
  } catch {
    return value;
  }
}

/** PO date as shown on the reference: 19.07.2025 */
function formatPoDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), "dd.MM.yyyy");
  } catch {
    return value;
  }
}

/**
 * Printed Delivery Challan — visual layout follows
 * `DC Sample.pdf` (Letter landscape, outer black border,
 * RE Sustainability logo, TRANSPORT COPY, two-column dispatch,
 * item table, bottom "DELIVERY CHALLAN" title).
 */
export default function DeliveryChallanPrint({
  challan,
}: DeliveryChallanPrintProps) {
  // Header GST under the logo = consignor / Dispatch From GST from the LR snapshot.
  const headerGst = (challan.consignorGst || "").trim();

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        {/* ===== Logo band ===== */}
        <div className={styles.logoBand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/delivery-challan/re-sustainability-logo.png"
            alt="RE Sustainability"
            className={styles.logo}
          />
        </div>

        {/* ===== GST / TRANSPORT COPY ===== */}
        <div className={styles.copyRow}>
          <div className={styles.gstNo}>GST NO:{headerGst}</div>
          <div className={styles.transportCopy}>TRANSPORT COPY</div>
        </div>

        {/* ===== Dispatch headers ===== */}
        <div className={styles.dispatchHeaderRow}>
          <div className={styles.dispatchHeaderCell}>
            <span className={styles.dispatchLabel}>Dispatch From :</span>
          </div>
          <div className={styles.dispatchHeaderCell}>
            <span className={styles.dispatchLabel}>Dispatch To :</span>
          </div>
        </div>

        {/* ===== Party bodies ===== */}
        <div className={styles.partyRow}>
          <div className={styles.partyCell}>
            <div className={styles.partyName}>{challan.consignor}</div>
            <div className={styles.byLine}>RE - {challan.byName}</div>
            <div className={styles.partyAddress}>{challan.consignorAddress}</div>
          </div>
          <div className={styles.partyCell}>
            <div className={styles.partyName}>{challan.consignee}</div>
            <div className={styles.partyAddress}>{challan.consigneeAddress}</div>
          </div>
        </div>

        {/* ===== GST row ===== */}
        <div className={styles.gstRow}>
          <div className={styles.gstCell}>
            GST: {challan.consignorGst || ""}
          </div>
          <div className={styles.gstCell}>
            GST: {challan.consigneeGst || ""}
          </div>
        </div>

        {/* ===== LR / PO meta ===== */}
        <div className={styles.metaRow}>
          <div className={styles.metaLeft}>
            <div className={styles.metaLine}>
              <span className={styles.metaKey}>LR DATE</span>
              <span className={styles.metaValue}>{formatLrDate(challan.lrDate)}</span>
            </div>
            <div className={styles.metaLine}>
              <span className={styles.metaKey}>LR NO</span>
              <span className={styles.metaValue}>: {challan.lrNumber}</span>
            </div>
          </div>
          <div className={styles.metaRight}>
            <div className={styles.metaLine}>
              <span className={styles.metaKey}>PO NO.</span>
              <span className={styles.metaValue}>{challan.poNumber}</span>
            </div>
            <div className={styles.metaLine}>
              <span className={styles.metaKey}>PO DATE</span>
              <span className={styles.metaValue}>:{formatPoDate(challan.poDate)}</span>
            </div>
          </div>
        </div>

        {/* ===== Item table ===== */}
        <table className={styles.itemTable}>
          <thead>
            <tr>
              <th className={styles.colSno}>S.NO</th>
              <th className={styles.colDesc}>DESCRIPTION</th>
              <th className={styles.colQty}>QTY</th>
              <th className={styles.colVehicle}>VEHICLE NO</th>
              <th className={styles.colHsn}>HSN</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.colSno}>1</td>
              <td className={styles.colDesc}>{challan.description}</td>
              <td className={`${styles.colQty} ${styles.qtyValue}`}>
                {Number(challan.qty).toFixed(3)}
              </td>
              <td className={`${styles.colVehicle} ${styles.vehicleValue}`}>
                {challan.vehicleNumber}
              </td>
              <td className={styles.colHsn}>{challan.hsn}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.title}>DELIVERY CHALLAN</div>
    </div>
  );
}
