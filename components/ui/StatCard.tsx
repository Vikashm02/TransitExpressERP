import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardTrend {
  /** Pre-formatted display value, e.g. "+12.5%" or "-4 this week" */
  value: string;
  direction?: "up" | "down" | "neutral";
}

interface StatCardProps {
  icon?: LucideIcon;
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: StatCardTrend;
  className?: string;
}

const TREND_STYLES: Record<
  NonNullable<StatCardTrend["direction"]>,
  { text: string; Icon: LucideIcon }
> = {
  up: { text: "text-success", Icon: ArrowUpRight },
  down: { text: "text-destructive", Icon: ArrowDownRight },
  neutral: { text: "text-muted-foreground", Icon: Minus },
};

export default function StatCard({
  icon: Icon,
  title,
  value,
  subtitle,
  trend,
  className,
}: StatCardProps) {
  const trendStyle = TREND_STYLES[trend?.direction ?? "up"];
  const TrendIcon = trendStyle.Icon;

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-shadow duration-200 hover:shadow-md",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/70 to-highlight" />
      <CardContent className="flex items-start justify-between gap-4 pt-1">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </p>

          <p className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-[1.65rem]">
            {value}
          </p>

          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}

          {trend && (
            <p className={cn("flex items-center gap-1 text-xs font-medium", trendStyle.text)}>
              <TrendIcon className="h-3 w-3" />
              {trend.value}
            </p>
          )}
        </div>

        {Icon && (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
