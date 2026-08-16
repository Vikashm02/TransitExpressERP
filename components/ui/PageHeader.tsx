import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface PageHeaderProps {
  title: string;
  buttonText: string;
  onAdd?: () => void;
  disabled?: boolean;
  /** Optional override for the default helper subtitle. */
  subtitle?: string;
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
  subtitle,
  showAddButton = true,
}: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 border-l-4 border-highlight pl-3 sm:pl-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Module
        </p>
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {subtitle ?? `Manage your ${title.toLowerCase()} efficiently.`}
        </p>
      </div>

      {showAddButton && (
        <Button
          onClick={onAdd}
          disabled={disabled}
          size="lg"
          className="w-full min-h-10 sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          {buttonText}
        </Button>
      )}
    </div>
  );
}
