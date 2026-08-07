interface SectionCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function SectionCard({
  title,
  subtitle,
  children,
}: SectionCardProps) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      <div className="px-6 py-5 border-b bg-slate-50">

        <h2 className="text-xl font-semibold text-slate-900">
          {title}
        </h2>

        {subtitle && (
          <p className="text-sm text-slate-500 mt-1">
            {subtitle}
          </p>
        )}

      </div>

      <div className="p-6">

        {children}

      </div>

    </section>
  );
}