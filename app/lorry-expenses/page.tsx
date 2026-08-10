import DashboardLayout from "@/components/layout/DashboardLayout";
import LorryExpenseListPage from "@/components/lorryExpense/LorryExpenseListPage";

export default function LorryExpensesPage() {
  return (
    <DashboardLayout>
      <LorryExpenseListPage />
    </DashboardLayout>
  );
}
