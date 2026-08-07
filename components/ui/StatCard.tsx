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
    <Card className={cn(className)}>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate text-sm font-medium text-muted-foreground">
            {title}
          </p>

          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </p>

          {subtitle && (
            <p className="text-xs text-muted-foreground">
              {subtitle}
            </p>
          )}

          {trend && (
            <p className={cn("flex items-center gap-1 text-xs font-medium", trendStyle.text)}>
              <TrendIcon className="h-3 w-3" />
              {trend.value}
            </p>
          )}
        </div>

        {Icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
