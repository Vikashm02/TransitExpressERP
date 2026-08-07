import DashboardLayout from "@/components/layout/DashboardLayout";
import CustomerTable from "@/components/customer/CustomerTable";

export default function CustomersPage() {
  return (
    <DashboardLayout>
      <CustomerTable />
    </DashboardLayout>
  );
}