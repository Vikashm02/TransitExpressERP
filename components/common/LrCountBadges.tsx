import { FileText } from "lucide-react";

/** LR usage pills for a master record's action strip (see lib/masterLrCounts.ts). */
export default function LrCountBadges({ items }: { items: { label: string; count: number }[] }) {
  return (
    <>
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-foreground"
        >
          <FileText className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="font-semibold tabular-nums">{item.count}</span>
          {item.label}
        </span>
      ))}
    </>
  );
}
