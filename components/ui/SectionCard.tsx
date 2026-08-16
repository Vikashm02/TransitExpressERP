interface SectionCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-border/80 bg-surface-muted/50 px-6 py-4">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}
