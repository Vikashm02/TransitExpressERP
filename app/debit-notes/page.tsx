import DashboardLayout from "@/components/layout/DashboardLayout";
import DebitNoteListPage from "@/components/debitNote/DebitNoteListPage";

export default function DebitNotesPage() {
  return (
    <DashboardLayout>
      <DebitNoteListPage />
    </DashboardLayout>
  );
}
