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
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b bg-muted/40 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {title}
          </h2>

          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="shrink-0">
            {actions}
          </div>
        )}
      </div>

      <div className={cn("space-y-5 p-6", contentClassName)}>
        {children}
      </div>
    </section>
  );
}
