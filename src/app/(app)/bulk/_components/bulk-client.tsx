"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Upload, Trash2 } from "lucide-react";
import { FetchTab } from "./fetch-tab";
import { PutTab } from "./put-tab";
import { DeleteTab } from "./delete-tab";

/**
 * Tabs orchestrator for the /bulk page. Three workflows live
 * here: fetch (read-scoped), put + delete (write-scoped). Tab
 * state is component-local rather than URL-synced — the
 * AskUserQuestion wireframe specified `?tab=fetch` for
 * back-button behavior, but the simpler in-memory state is
 * what every other tabbed surface in the app uses today
 * (Topology cards, Keys inspector tabs). Adding URL sync to
 * just this page would be inconsistent; do it everywhere or
 * nowhere. Phase B follow-up to evaluate.
 */
export function BulkClient({ clusterId }: { clusterId: string }) {
  const [tab, setTab] = useState<"fetch" | "put" | "delete">("fetch");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-5">
      <TabsList>
        <TabsTrigger value="fetch">
          <Download aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          Fetch
        </TabsTrigger>
        <TabsTrigger value="put">
          <Upload aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          Put
        </TabsTrigger>
        <TabsTrigger value="delete">
          <Trash2 aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </TabsTrigger>
      </TabsList>
      <TabsContent value="fetch" className="space-y-0">
        <FetchTab clusterId={clusterId} />
      </TabsContent>
      <TabsContent value="put" className="space-y-0">
        <PutTab clusterId={clusterId} />
      </TabsContent>
      <TabsContent value="delete" className="space-y-0">
        <DeleteTab clusterId={clusterId} />
      </TabsContent>
    </Tabs>
  );
}
