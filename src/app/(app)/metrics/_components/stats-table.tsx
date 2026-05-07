"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Stats } from "@/lib/api/metrics";
import { LineChart } from "lucide-react";

/**
 * Per-name stats from `/stats`. The cache exposes whatever
 * metrics the StatsCollector middleware has registered — names
 * are dynamic and we don't pretend to know them. Sorted by name
 * so a deterministic order makes scanning the same column
 * possible across reloads.
 */
export function StatsTable({ stats }: { stats: Stats | undefined }) {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
          <LineChart aria-hidden className="h-4 w-4" />
        </span>
        <div>
          <CardTitle>Per-name stats</CardTitle>
          <CardDescription>Statistical summaries from registered StatsCollectors.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {stats === undefined ? (
          <p className="text-muted-foreground text-sm">No stats data.</p>
        ) : Object.keys(stats).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No metrics registered — the cache emits an empty map until a StatsCollector middleware wraps the
            backend.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Sum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(stats)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, stat]) => (
                    <TableRow key={name}>
                      <TableCell className="font-mono">{name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stat.Count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtFloat(stat.Mean)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtFloat(stat.Median)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stat.Min.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stat.Max.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {stat.Sum.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function fmtFloat(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.01) return n.toExponential(2);
  if (Math.abs(n) < 1) return n.toFixed(3);
  if (Math.abs(n) < 1000) return n.toFixed(2);
  return Math.round(n).toLocaleString();
}
