import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  buttonText: string;
  onAdd?: () => void;
  disabled?: boolean;
  /** Set to `false` to hide the action button entirely — used by pages
   * to enforce "create_view"/"edit" permission (Staff / Sub-User Access
   * Control) by hiding the button rather than merely disabling it,
   * matching the Sidebar's hide-not-disable convention. Defaults to
   * `true` so every existing call site keeps rendering the button. */
  showAddButton?: boolean;
}

export default function PageHeader({
  title,
  buttonText,
  onAdd,
  disabled,
  showAddButton = true,
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

      {showAddButton && (
        <Button
          onClick={onAdd}
          disabled={disabled}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          {buttonText}
        </Button>
      )}
    </div>
  );
}
