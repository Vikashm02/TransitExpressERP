import { supabase } from "@/lib/supabase";
import type { Customer } from "@/components/customer/customer.schema";

/** A persisted customer row, as returned by Supabase (adds server-owned columns). */
export interface CustomerRecord extends Customer {
  id: number;
  created_at?: string;
}

const TABLE = "customers";

/**
 * Business codes follow the same "C001", "C002", ... convention the module
 * always displayed. Sequenced off the current row count, which is adequate
 * for a low-concurrency master data table.
 */
async function generateCustomerCode(): Promise<string> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `C${String(next).padStart(3, "0")}`;
}

/* ==========================================================
   GET ALL CUSTOMERS
========================================================== */

export async function getCustomers(): Promise<CustomerRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as CustomerRecord[];
}

/* ==========================================================
   GET ONE CUSTOMER
========================================================== */

export async function getCustomer(id: number): Promise<CustomerRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data as CustomerRecord;
}

/* ==========================================================
   CREATE CUSTOMER
========================================================== */

export async function createCustomer(values: Customer): Promise<CustomerRecord> {
  const code = values.code.trim() || (await generateCustomerCode());

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      code,
      name: values.name,
      gst: values.gst,
      mobile: values.mobile,
      email: values.email,
      city: values.city,
      address: values.address,
      status: values.status,
    })
    .select()
    .single();

  if (error) throw error;

  return data as CustomerRecord;
}

/* ==========================================================
   UPDATE CUSTOMER
========================================================== */

export async function updateCustomer(
  id: number,
  values: Customer
): Promise<CustomerRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      name: values.name,
      gst: values.gst,
      mobile: values.mobile,
      email: values.email,
      city: values.city,
      address: values.address,
      status: values.status,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data as CustomerRecord;
}

/* ==========================================================
   DELETE CUSTOMER
========================================================== */

export async function deleteCustomer(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
