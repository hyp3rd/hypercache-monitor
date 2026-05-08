"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

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

  // The React Compiler lint plugin emits an "incompatible library"
  // warning here (`react-hooks/incompatible-library`). It's
  // informational and intentionally left visible:
  //
  //   - `useReactTable()` returns getter closures
  //     (`table.getRowModel()`, `cell.getContext()`, etc.) that
  //     compute on each call. Memoizing those across renders
  //     would produce stale UI, so React Compiler opts this
  //     component out of auto-memoization. That's the *correct*
  //     behavior, not a defect — the compiler is telling us
  //     "I'm honoring TanStack's design and skipping the
  //     optimization that would break it."
  //   - For our paginated 50-row tables the perf impact of the
  //     opt-out is negligible; auto-memo wouldn't be a meaningful
  //     win even if it were safe.
  //   - There's no fix on our side without dropping TanStack
  //     Table entirely (which would mean re-implementing
  //     sorting / filtering / pagination by hand). Tracked in the
  //     library: TanStack/table#5567 — until upstream lands a
  //     React-Compiler-friendly API the warning is the right
  //     signal to leave in place rather than silence.
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
                            sorted ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" && <ArrowUp aria-hidden className="h-3 w-3" />}
                          {sorted === "desc" && <ArrowDown aria-hidden className="h-3 w-3" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
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
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
            <span className="text-foreground font-mono">{table.getState().pagination.pageIndex + 1}</span> of{" "}
            <span className="text-foreground font-mono">{table.getPageCount()}</span> ·{" "}
            <span className="text-foreground font-mono">{table.getFilteredRowModel().rows.length}</span> rows
          </p>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
