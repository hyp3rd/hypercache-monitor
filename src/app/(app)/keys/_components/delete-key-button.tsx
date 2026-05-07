"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CacheApiError, deleteKey } from "@/lib/api/keys";
import { queryKeys } from "@/lib/query/keys";

/**
 * Two-step delete via shadcn AlertDialog. Operator clicks
 * Delete → confirmation modal → the actual DELETE only fires
 * on Confirm. Toasts on both success and failure so the
 * outcome is unmistakable even when the modal closes
 * quickly.
 *
 * On success, invalidates the key's query and lifts an
 * onAfterDelete callback so the parent can drop the URL
 * search param (return to the empty state).
 */
export function DeleteKeyButton({
  clusterId,
  keyName,
  onAfterDelete,
}: {
  clusterId: string;
  keyName: string;
  onAfterDelete: () => void;
}) {
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        const result = await deleteKey(clusterId, keyName);
        await qc.invalidateQueries({ queryKey: queryKeys.key(clusterId, keyName) });
        toast.success(
          result.deleted
            ? `Deleted ${keyName} from ${result.owners.length} owner${result.owners.length === 1 ? "" : "s"}`
            : `${keyName} did not exist`,
        );
        onAfterDelete();
      } catch (err) {
        const e = err as CacheApiError;
        toast.error(`Delete failed (${e.code ?? "?"}): ${e.message ?? "unknown"}`);
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-2">
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this key?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="text-foreground font-mono break-all">{keyName}</span> will be removed from every
            replica on cluster <span className="font-mono">{clusterId}</span>. The operation is idempotent —
            if the key never existed, the cluster reports success without a side effect.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending} className="gap-2">
            {pending && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
