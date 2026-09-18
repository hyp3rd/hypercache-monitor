"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";

/**
 * Thin wrapper around `@tanstack/react-table` v8 with the
 * three features the bulk-results surface actually needs:
 *
 *   - column-header sorting (asc / desc / unsorted toggle)
 *   - global text filter across all columns (single textbox)
 *   - paginated rendering at 50 rows / page (DOM weight cap)
 *
 * Anything fancier (column resizing, row selection, sticky
 * headers) is deliberately out of scope. Bulk results are
 * read-mostly tables operators scan and download — they're
 * not a primary interaction surface.
 *
 * The `globalFilter` input is uncontrolled-by-default; a
 * caller wanting to drive filter state from outside (e.g.,
 * a "Show only failed rows" checkbox) can pass `filter` +
 * `onFilterChange`.
 */

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Placeholder text for the global filter input. */
  filterPlaceholder?: string;
  /**
   * `true` (default) renders the filter input above the table.
   * Pass `false` for tables short enough that filter chrome is
   * noise.
   */
  showFilter?: boolean;
  /** Empty-state copy when `data.length === 0`. */
  emptyState?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterPlaceholder = "Filter rows…",
  showFilter = true,
  emptyState = "No rows.",
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // `useReactTable()` returns getter closures (`table.getRowModel()`,
  // `cell.getContext()`, etc.) that recompute on every call.
  // Memoizing them across renders would produce stale UI, so React
  // Compiler skips this component — the correct behavior, which the
  // `react-hooks/incompatible-library` rule surfaces as a warning.
  //
  // The skip is acknowledged and accepted: tables are paginated at
  // 50 rows, so a full re-render per state change is cheap, and the
  // only alternative is dropping TanStack Table. Silencing the rule
  // here (a `"use no memo"` directive does not quiet it) keeps
  // `eslint .` warning-free without changing runtime behavior.
  // Revisit once TanStack Table ships a compiler-friendly API
  // (TanStack/table#5567).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  return (
    <div className="space-y-3">
      {showFilter && data.length > 0 && (
        <Input
          aria-label="Filter table rows"
          placeholder={filterPlaceholder}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
      )}
      <div className="border-border/50 rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id}>
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "hover:text-foreground inline-flex items-center gap-1.5 text-left text-xs font-medium tracking-wide uppercase transition-colors",
                            sorted
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === "asc" && (
                            <ArrowUp
                              aria-hidden
                              className="h-3 w-3"
                            />
                          )}
                          {sorted === "desc" && (
                            <ArrowDown
                              aria-hidden
                              className="h-3 w-3"
                            />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
          <p>
            Page{" "}
            <span className="text-foreground font-mono">
              {table.getState().pagination.pageIndex + 1}
            </span>{" "}
            of{" "}
            <span className="text-foreground font-mono">
              {table.getPageCount()}
            </span>{" "}
            ·{" "}
            <span className="text-foreground font-mono">
              {table.getFilteredRowModel().rows.length}
            </span>{" "}
            rows
          </p>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft
                aria-hidden
                className="h-3.5 w-3.5"
              />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight
                aria-hidden
                className="h-3.5 w-3.5"
              />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
