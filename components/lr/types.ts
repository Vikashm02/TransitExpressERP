export interface LR {
  // ===========================
  // LR Information
  // ===========================

  lrNumber: string;
  lrDate: string;

  bookingBranch: string;

  customer: string;

  billingParty: "Consignor" | "Consignee";

  // ===========================
  // Consignor
  // ===========================

  consignor: string;
  consignorGST: string;
  consignorAddress: string;

  // ===========================
  // Consignee
  // ===========================

  consignee: string;
  consigneeGST: string;
  consigneeAddress: string;

  // ===========================
  // Vehicle & Route
  // ===========================

  vehicleNumber: string;
  vehicleType: string;

  transporter: string;

  driverName: string;
  driverMobile: string;

  from: string;
  to: string;

  // ===========================
  // Material
  // ===========================

  material: string;

  packageType: string;

  packages: number;

  loadingWeight: number;

  unloadingWeight: number;

  chargedWeight: number;

  // ===========================
  // Dispatch Documents
  // ===========================

  poNumber: string;

  vendorCode: string;

  dcNumber: string;

  dcDate: string;

  invoiceNumber: string;

  invoiceDate: string;

  invoiceValue: number;

  ewayBillNumber: string;

  // ===========================
  // Commercial (Hidden)
  // ===========================

  billRate: number;

  billRateType:
    | "Fixed"
    | "Per Ton (Loading)"
    | "Per Ton (Unloading)"
    | "Guaranteed Weight";

  guaranteedWeight: number;

  lorryHireRate: number;

  lorryHireType:
    | "Fixed"
    | "Per Ton";

  freightType:
    | "Paid"
    | "To Pay"
    | "To Be Billed";

  driverAdvance: number;

  dieselAdvance: number;

  stChallan: number;

  loadingCharges: number;

  unloadingCharges: number;

  hamali: number;

  commission: number;

  otherExpense: number;

  // ===========================
  // Calculated
  // ===========================

  billAmount: number;

  lorryHireAmount: number;

  profitAmount: number;

  // ===========================
  // Remarks
  // ===========================

  remarks: string;

  internalRemarks: string;

  // ===========================
  // Status
  // ===========================

  status:
    | "Open"
    | "Delivered"
    | "Billed";

  createdAt: string;

  updatedAt: string;
}