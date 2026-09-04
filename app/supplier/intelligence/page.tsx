import DashboardLayout from "@/components/layout/DashboardLayout";
import SupplierIntelligencePage from "@/components/supplierIntelligence/SupplierIntelligencePage";

/**
 * Supplier Intelligence workspace — first functional vertical slice.
 * Uses migration 067 tables via authenticated Supabase client + RLS.
 */
export default function SupplierIntelligenceRoutePage() {
  return (
    <DashboardLayout>
      <SupplierIntelligencePage />
    </DashboardLayout>
  );
}
