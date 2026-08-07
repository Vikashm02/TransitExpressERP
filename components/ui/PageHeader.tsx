import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  buttonText: string;
  onAdd?: () => void;
  disabled?: boolean;
}

export default function PageHeader({
  title,
  buttonText,
  onAdd,
  disabled,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your {title.toLowerCase()} efficiently.
        </p>
      </div>

      <Button
        onClick={onAdd}
        disabled={disabled}
      >
        <Plus className="mr-2 h-4 w-4" />
        {buttonText}
      </Button>
    </div>
  );
}
