"use client";

import { Search, Download, RotateCw, type LucideIcon } from "lucide-react";
import type { VariantProps } from "class-variance-authority";

import { Input } from "@/components/ui/input";
import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

export interface SearchToolbarFilter {
  key: string;
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface SearchToolbarAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: ButtonVariant;
}

interface SearchToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  onExport?: () => void;
  onRefresh?: () => void;

  /** Dropdown filters rendered next to the search input. */
  filters?: SearchToolbarFilter[];
  /** Extra action buttons rendered alongside Refresh/Export. */
  actions?: SearchToolbarAction[];

  /** Renders a contextual bulk-actions bar when greater than 0. */
  selectedCount?: number;
  bulkActions?: SearchToolbarAction[];
  onClearSelection?: () => void;

  className?: string;
}

export default function SearchToolbar({
  search,
  onSearchChange,
  placeholder = "Search...",
  onExport,
  onRefresh,
  filters,
  actions,
  selectedCount = 0,
  bulkActions,
  onClearSelection,
  className,
}: SearchToolbarProps) {
  return (
    <div className={cn("mb-6 space-y-3", className)}>
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {selectedCount} selected
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {bulkActions?.map((action) => {
              const ActionIcon = action.icon;

              return (
                <Button
                  key={action.key}
                  size="sm"
                  variant={action.variant ?? "outline"}
                  onClick={action.onClick}
                >
                  {ActionIcon && <ActionIcon className="mr-1.5 h-3.5 w-3.5" />}
                  {action.label}
                </Button>
              );
            })}
          </div>

          {onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 erp-panel p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              className="pl-10"
              value={search}
              placeholder={placeholder}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          {filters && filters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filters.map((filter) => (
                <Select
                  key={filter.key}
                  value={filter.value === "" ? undefined : filter.value}
                  onValueChange={(value) => filter.onChange((value as string) ?? "")}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-auto min-w-32"
                  >
                    <SelectValue placeholder={filter.placeholder ?? filter.label} />
                  </SelectTrigger>

                  <SelectContent>
                    {filter.options.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={onRefresh}
          >
            <RotateCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          <Button
            variant="outline"
            onClick={onExport}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>

          {actions?.map((action) => {
            const ActionIcon = action.icon;

            return (
              <Button
                key={action.key}
                variant={action.variant ?? "outline"}
                onClick={action.onClick}
              >
                {ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
                {action.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
