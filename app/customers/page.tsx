import DashboardLayout from "@/components/layout/DashboardLayout";
import CustomerListPage from "@/components/customer/CustomerListPage";

export default function CustomersPage() {
  return (
    <DashboardLayout>
      <CustomerListPage />
    </DashboardLayout>
  );
}