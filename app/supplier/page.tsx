import { redirect } from "next/navigation";

import { SUPPLIER_HOME } from "@/lib/app-area";

export default function SupplierIndexPage() {
  redirect(SUPPLIER_HOME);
}
