import { supabase } from "@/lib/supabase";
import { LR } from "@/components/lr/types";

/* ==========================================================
   CREATE LR
========================================================== */

export async function saveLR(lr: LR) {
  const { data, error } = await supabase
    .from("lrs")
    .insert({
      lr_number: lr.lrNumber,
      lr_date: lr.lrDate,

      booking_branch: lr.bookingBranch,

      customer: lr.customer,

      billing_party: lr.billingParty,

      consignor: lr.consignor,
      consignor_gst: lr.consignorGST,
      consignor_address: lr.consignorAddress,

      consignee: lr.consignee,
      consignee_gst: lr.consigneeGST,
      consignee_address: lr.consigneeAddress,

      vehicle_number: lr.vehicleNumber,
      vehicle_type: lr.vehicleType,

      transporter: lr.transporter,

      driver_name: lr.driverName,
      driver_mobile: lr.driverMobile,

      from_station: lr.from,
      to_station: lr.to,

      material: lr.material,
      package_type: lr.packageType,
      packages: lr.packages,

      loading_weight: lr.loadingWeight,
      unloading_weight: lr.unloadingWeight,
      charged_weight: lr.chargedWeight,

      po_number: lr.poNumber,
      vendor_code: lr.vendorCode,

      dc_number: lr.dcNumber,
      dc_date: lr.dcDate,

      invoice_number: lr.invoiceNumber,
      invoice_date: lr.invoiceDate,
      invoice_value: lr.invoiceValue,

      eway_bill_number: lr.ewayBillNumber,

      bill_rate: lr.billRate,
      bill_rate_type: lr.billRateType,

      guaranteed_weight: lr.guaranteedWeight,

      lorry_hire_rate: lr.lorryHireRate,
      lorry_hire_type: lr.lorryHireType,

      freight_type: lr.freightType,

      driver_advance: lr.driverAdvance,
      diesel_advance: lr.dieselAdvance,
      st_challan: lr.stChallan,

      loading_charges: lr.loadingCharges,
      unloading_charges: lr.unloadingCharges,

      hamali: lr.hamali,
      commission: lr.commission,
      other_expense: lr.otherExpense,

      bill_amount: lr.billAmount,
      lorry_hire_amount: lr.lorryHireAmount,
      profit_amount: lr.profitAmount,

      remarks: lr.remarks,
      internal_remarks: lr.internalRemarks,

      status: lr.status,
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/* ==========================================================
   GET ALL LR
========================================================== */

export async function getLRs() {
  const { data, error } = await supabase
    .from("lrs")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  if (error) throw error;

  return data ?? [];
}

/* ==========================================================
   GET ONE LR
========================================================== */

export async function getLR(id: number) {
  const { data, error } = await supabase
    .from("lrs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}

/* ==========================================================
   UPDATE LR
========================================================== */

export async function updateLR(
  id: number,
  values: Partial<LR>
) {
  const { data, error } = await supabase
    .from("lrs")
    .update(values)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data;
}

/* ==========================================================
   CANCEL LR
========================================================== */

export async function cancelLR(id: number) {
  const { data, error } = await supabase
    .from("lrs")
    .update({
      status: "Cancelled",
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data;
}