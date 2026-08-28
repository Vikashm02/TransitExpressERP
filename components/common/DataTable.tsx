"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Inbox,
  Search,
  type LucideIcon,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

export type DataTableSortDirection = "asc" | "desc";
type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Full control over how the cell renders. Takes priority over `type`. */
  render?: (row: T, index: number) => React.ReactNode;
  /** Shorthand for rendering the raw value through StatusBadge. */
  type?: "text" | "status";
  sortable?: boolean;
  /** Custom value extractor used for sorting, when the raw cell value isn't sortable as-is. */
  sortAccessor?: (row: T) => string | number | Date;
  align?: "left" | "center" | "right";
  width?: string;
  className?: string;
  headerClassName?: string;
}

export interface DataTableAction<T> {
  label: string;
  icon?: LucideIcon;
  onClick: (row: T) => void;
  variant?: ButtonVariant;
  hidden?: (row: T) => boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey?: (row: T, index: number) => string | number;

  loading?: boolean;
  loadingRows?: number;

  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;

  /** Per-row action buttons (Edit / Delete / etc). On desktop they render
   * directly under the record; on mobile they stay under the card. */
  actions?: DataTableAction<T>[];

  /** Clicking the row (desktop table or mobile card) selects/opens it. */
  onRowClick?: (row: T) => void;
  /** Optional className for each data row (e.g. draft highlight). */
  getRowClassName?: (row: T) => string | undefined;
  /** Highlight the currently selected row when using row selection. */
  selectedRowKey?: string | number | null;

  /** Optional built-in search box, for standalone usage (e.g. lookup dialogs)
   *  that don't already sit below a `SearchToolbar`. */
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  /** Enables header-click sorting. */
  sortable?: boolean;
  defaultSort?: { key: string; direction: DataTableSortDirection };
  /** Controlled sorting (e.g. server-side) — provide together with `onSortChange`. */
  sortKey?: string;
  sortDirection?: DataTableSortDirection;
  onSortChange?: (key: string, direction: DataTableSortDirection) => void;

  /** Uncontrolled client-side pagination — DataTable slices `data` itself. */
  pageSize?: number;
  /** Controlled/server-driven pagination — `data` is assumed to already be the current page. */
  page?: number;
  onPageChange?: (page: number) => void;
  totalItems?: number;

  stickyHeader?: boolean;
  /** Enables an internally scrollable body (pairs well with `stickyHeader`). */
  maxHeight?: string;
  className?: string;
}

const DEFAULT_LOADING_ROWS = 5;

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  rowKey,
  loading = false,
  loadingRows = DEFAULT_LOADING_ROWS,
  emptyTitle = "No records found",
  emptyDescription,
  emptyIcon: EmptyIcon = Inbox,
  actions,
  onRowClick,
  getRowClassName,
  selectedRowKey = null,
  searchable = false,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  sortable = false,
  defaultSort,
  sortKey: controlledSortKey,
  sortDirection: controlledSortDirection,
  onSortChange,
  pageSize,
  page: controlledPage,
  onPageChange,
  totalItems,
  stickyHeader = true,
  maxHeight,
  className,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<
    { key: string; direction: DataTableSortDirection } | undefined
  >(defaultSort);
  const [internalPage, setInternalPage] = useState(1);

  const isSortControlled = controlledSortKey !== undefined && onSortChange !== undefined;
  const activeSort = isSortControlled
    ? controlledSortKey
      ? { key: controlledSortKey, direction: controlledSortDirection ?? "asc" }
      : undefined
    : internalSort;

  const isPageControlled = controlledPage !== undefined && onPageChange !== undefined;
  const activePage = isPageControlled ? (controlledPage as number) : internalPage;

  function handleSortClick(column: DataTableColumn<T>) {
    if (!column.sortable) return;

    const nextDirection: DataTableSortDirection =
      activeSort?.key === column.key && activeSort.direction === "asc" ? "desc" : "asc";

    if (isSortControlled) {
      onSortChange!(column.key, nextDirection);
    } else {
      setInternalSort({ key: column.key, direction: nextDirection });
    }
  }

  const sortedData = useMemo(() => {
    if (isSortControlled || !activeSort) return data;

    const column = columns.find((c) => c.key === activeSort.key);
    const accessor = column?.sortAccessor ?? ((row: T) => row[activeSort.key]);

    return [...data].sort((a, b) => {
      const valueA = accessor(a);
      const valueB = accessor(b);

      if (valueA == null) return 1;
      if (valueB == null) return -1;

      if (valueA > valueB) return activeSort.direction === "asc" ? 1 : -1;
      if (valueA < valueB) return activeSort.direction === "asc" ? -1 : 1;
      return 0;
    });
  }, [data, activeSort, isSortControlled, columns]);

  const totalCount = totalItems ?? sortedData.length;
  const totalPages = pageSize ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;

  const pagedData = useMemo(() => {
    if (isPageControlled || !pageSize) return sortedData;

    const start = (activePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, activePage, pageSize, isPageControlled]);

  function goToPage(next: number) {
    const clamped = Math.min(Math.max(next, 1), totalPages);

    if (isPageControlled) {
      onPageChange!(clamped);
    } else {
      setInternalPage(clamped);
    }
  }

  const showPagination = Boolean(pageSize || (isPageControlled && totalItems));
  const hasActions = Boolean(actions && actions.length > 0);
  // Actions render below each record on desktop (not a far-right column),
  // so they do not add to the table column count / horizontal width.
  const columnCount = columns.length;

  // Mobile card list (below `md`) shows the same columns/actions as the
  // desktop table, just stacked vertically instead of forced into a
  // cramped horizontal scroller. The first column is the card's title;
  // a "status"-typed column (if any) becomes a badge next to it; every
  // other column renders as a label/value row.
  const titleColumn = columns[0];
  const statusColumn = columns.find((c) => c.type === "status" && c !== titleColumn);
  const detailColumns = columns.filter((c) => c !== titleColumn && c !== statusColumn);

  function renderCellValue(column: DataTableColumn<T>, row: T, index: number) {
    if (column.render) return column.render(row, index);
    if (column.type === "status") return <StatusBadge status={String(row[column.key] ?? "")} />;
    return row[column.key];
  }

  function visibleActionsFor(row: T): DataTableAction<T>[] {
    if (!actions?.length) return [];
    return actions.filter((action) => !action.hidden?.(row));
  }

  function renderActionButtons(row: T) {
    return visibleActionsFor(row).map((action) => {
      const ActionIcon = action.icon;
      return (
        <Button
          key={action.label}
          size="sm"
          variant={action.variant ?? "outline"}
          onClick={() => action.onClick(row)}
        >
          {ActionIcon && <ActionIcon className="h-3.5 w-3.5" />}
          {action.label}
        </Button>
      );
    });
  }

  return (
    <div className={cn("erp-panel overflow-hidden", className)}>
      {searchable && (
        <div className="border-b p-3">
          <div className="relative max-w-sm">
            <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              className="pl-8"
              value={searchValue}
              placeholder={searchPlaceholder}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Desktop / tablet: data columns stay in the table; per-row
       * actions render on a second row directly under that record so
       * staff do not need to scroll horizontally to reach them. */}
      <div
        className="hidden overflow-auto md:block"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <Table>
          <TableHeader>
            <TableRow className={stickyHeader ? "sticky top-0 z-10 border-b bg-surface-muted/95 backdrop-blur-sm" : "bg-surface-muted/40"}>
              {columns.map((column) => {
                const isActive = activeSort?.key === column.key;
                const canSort = sortable && column.sortable;

                return (
                  <TableHead
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      // Keep headers readable; allow wrap if a label is long,
                      // overriding ui/table whitespace-nowrap.
                      "whitespace-normal break-words [overflow-wrap:anywhere]",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      canSort && "cursor-pointer select-none hover:text-foreground",
                      column.headerClassName
                    )}
                    onClick={() => canSort && handleSortClick(column)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {column.header}

                      {canSort &&
                        (isActive ? (
                          activeSort!.direction === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                        ))}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: loadingRows }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {Array.from({ length: Math.max(columnCount, 1) }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <div className="h-4 w-full max-w-32 animate-pulse rounded bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : pagedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={Math.max(columnCount, 1)}
                  className="py-14"
                >
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <EmptyIcon className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-foreground">
                      {emptyTitle}
                    </p>
                    {emptyDescription && (
                      <p className="text-sm text-muted-foreground">
                        {emptyDescription}
                      </p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pagedData.map((row, index) => {
                const key = rowKey ? rowKey(row, index) : index;
                const selected = selectedRowKey != null && selectedRowKey === key;
                const rowActions = visibleActionsFor(row);
                const rowClassName = cn(
                  onRowClick && "cursor-pointer hover:bg-muted/60",
                  selected && "bg-primary/8 ring-1 ring-inset ring-primary/25",
                  getRowClassName?.(row)
                );
                return (
                <Fragment key={key}>
                <TableRow
                  className={cn(
                    rowClassName,
                    rowActions.length > 0 && "border-b-0 hover:bg-muted/60"
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        // Override ui/table whitespace-nowrap so long names
                        // (consignor, consignee, vehicle, etc.) wrap within
                        // the available desktop width instead of stretching
                        // the table horizontally.
                        "max-w-[18rem] whitespace-normal break-words align-top [overflow-wrap:anywhere]",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                        column.className
                      )}
                    >
                      {column.render
                        ? column.render(row, index)
                        : column.type === "status"
                        ? <StatusBadge status={String(row[column.key] ?? "")} />
                        : row[column.key]}
                    </TableCell>
                  ))}
                </TableRow>
                {rowActions.length > 0 && (
                  <TableRow
                    className={cn(
                      rowClassName,
                      "border-b"
                    )}
                  >
                    <TableCell
                      colSpan={Math.max(columnCount, 1)}
                      className="whitespace-normal pt-0 pb-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-2.5">
                        {renderActionButtons(row)}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: compact stacked cards instead of the desktop table —
       * same data/actions/permission-driven `hidden` rules, just laid
       * out vertically so nothing gets clipped on a phone width. */}
      <div
        className="divide-y overflow-auto md:hidden"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {loading ? (
          Array.from({ length: loadingRows }).map((_, rowIndex) => (
            <div key={`mobile-skeleton-${rowIndex}`} className="space-y-2 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))
        ) : pagedData.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
            <EmptyIcon className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">
              {emptyTitle}
            </p>
            {emptyDescription && (
              <p className="text-sm text-muted-foreground">
                {emptyDescription}
              </p>
            )}
          </div>
        ) : (
          pagedData.map((row, index) => {
            const key = rowKey ? rowKey(row, index) : index;
            const selected = selectedRowKey != null && selectedRowKey === key;
            return (
            <div
              key={key}
              className={cn(
                "space-y-3 p-4",
                onRowClick && "cursor-pointer hover:bg-muted/40",
                selected && "bg-primary/8 ring-1 ring-inset ring-primary/25",
                getRowClassName?.(row)
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {renderCellValue(titleColumn, row, index)}
                </p>

                {statusColumn && (
                  <div className="shrink-0">
                    {renderCellValue(statusColumn, row, index)}
                  </div>
                )}
              </div>

              {detailColumns.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  {detailColumns.map((column) => (
                    <div key={column.key} className="min-w-0">
                      <dt className="truncate text-xs text-muted-foreground">
                        {column.header}
                      </dt>
                      <dd
                        className={cn(
                          "truncate font-medium text-foreground",
                          column.align === "right" && "text-right"
                        )}
                      >
                        {renderCellValue(column, row, index)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {hasActions && (
                <div
                  className="flex flex-wrap gap-2 border-t pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderActionButtons(row)}
                </div>
              )}
            </div>
          );
          })
        )}
      </div>

      {showPagination && !loading && pagedData.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Page {activePage} of {totalPages} &middot; {totalCount} total
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={activePage <= 1}
              onClick={() => goToPage(activePage - 1)}
            >
              Previous
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={activePage >= totalPages}
              onClick={() => goToPage(activePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
