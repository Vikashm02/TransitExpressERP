import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  buttonText: string;
  onAdd?: () => void;
}

export default function PageHeader({
  title,
  buttonText,
  onAdd,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          {title}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your {title.toLowerCase()} efficiently.
        </p>
      </div>

      <Button
        onClick={onAdd}
        className="bg-[#0B3A67] hover:bg-[#0F4A87]"
      >
        <Plus className="w-4 h-4 mr-2" />
        {buttonText}
      </Button>
    </div>
  );
}