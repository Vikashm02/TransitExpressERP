import { cn } from "@/lib/utils";

interface FormSectionProps {
  title: string;
  subtitle?: string;
  /** Optional right-aligned slot in the header, e.g. a "Search" or "Add" button */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function FormSection({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: FormSectionProps) {
  return (
    <section className={cn("erp-panel overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-border/80 bg-surface-muted/50 px-4 py-3.5 sm:px-6 sm:py-4">
        <div className="min-w-0 border-l-2 border-primary pl-3">
          <h2 className="font-heading text-base font-semibold tracking-tight text-foreground sm:text-lg">
            {title}
          </h2>

          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      <div className={cn("space-y-5 p-4 sm:p-6", contentClassName)}>{children}</div>
    </section>
  );
}
