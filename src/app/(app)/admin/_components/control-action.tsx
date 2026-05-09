"use client";

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
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * One destructive admin control (evict, trigger-expiration, clear).
 * Renders a card with the action description and a button that
 * opens an AlertDialog confirm before POSTing to the cluster's
 * mgmt control proxy. Server-side scope enforcement is the real
 * gate; this component's job is the UX confirmation step that
 * makes a fat-finger of "Clear cluster" cost two clicks instead
 * of one.
 *
 * Why a per-control component (not a single dispatcher):
 *   - Each control's confirm copy is materially different.
 *     Evict triggers a sweep and is reversible (data isn't lost).
 *     Clear is irreversible and wipes the cluster. The dialog
 *     bodies need to convey those distinct stakes.
 *   - The "danger" tone (destructive button variant, amber/red
 *     accent) is per-control: only Clear gets the full red
 *     destructive variant.
 */

export type ControlOp = "evict" | "trigger-expiration" | "clear";

interface ControlActionProps {
  clusterId: string;
  op: ControlOp;
  title: string;
  summary: string;
  /**
   * Pre-rendered icon JSX from the parent (server component).
   * Receiving a ReactNode rather than a component reference keeps
   * the prop boundary RSC-serializable — Next refuses to pass a
   * function/component reference across the server-to-client
   * border, but it serializes JSX elements just fine.
   */
  icon: ReactNode;
  /**
   * Tone — controls the button + accent color. "danger" is the
   * irreversible-destruction case (Clear); "warn" is for sweeps
   * that don't lose data (Evict, Trigger Expiration).
   */
  tone: "warn" | "danger";
  /** AlertDialog title — usually the verb form ("Clear cluster?"). */
  confirmTitle: string;
  /** AlertDialog body — what the operator is about to do. */
  confirmBody: string;
  /** Confirm button label inside the dialog. */
  confirmLabel: string;
  /** Toast text on a successful run. */
  successToast: string;
}

export function ControlAction({
  clusterId,
  op,
  title,
  summary,
  icon,
  tone,
  confirmTitle,
  confirmBody,
  confirmLabel,
  successToast,
}: ControlActionProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(`/api/clusters/${encodeURIComponent(clusterId)}/mgmt/control/${op}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        toast.error(`${title} failed: ${(err as Error).message}`);
        setOpen(false);
        return;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        const msg = body.error ?? `HTTP ${response.status}`;
        toast.error(`${title} failed: ${msg}`);
        setOpen(false);
        return;
      }

      toast.success(successToast);
      setOpen(false);
    });
  }

  const buttonVariant = tone === "danger" ? "destructive" : "default";
  const cardAccent = tone === "danger" ? "ring-destructive/30" : "ring-amber-500/20";

  return (
    <Card className={`border-border/50 bg-card/60 ring-1 ${cardAccent} backdrop-blur`}>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-md ring-1 ${
            tone === "danger"
              ? "bg-destructive/10 text-destructive ring-destructive/30"
              : "bg-amber-500/10 text-amber-400 ring-amber-500/30"
          }`}
        >
          {icon}
        </span>
        <div className="flex-1">
          {/* h2 (not <CardTitle>) so axe / Playwright `getByRole("heading", ...)`
              treats this as a proper landmark. shadcn's CardTitle renders a
              <div data-slot="card-title">, which is invisible to a11y heading
              queries. */}
          <h2 className="text-base font-semibold">{title}</h2>
          <CardDescription className="mt-0.5">{summary}</CardDescription>
        </div>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant={buttonVariant} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  Running…
                </>
              ) : (
                title
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant={buttonVariant}
                onClick={(e) => {
                  // Keep the dialog open until the request settles
                  // so the operator sees the spinner; the action
                  // closes it explicitly via setOpen(false).
                  e.preventDefault();
                  onConfirm();
                }}
                disabled={pending}
              >
                {pending ? "Running…" : confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="text-muted-foreground text-xs">
        <span className="font-mono">
          POST /api/clusters/{clusterId}/mgmt/control/{op}
        </span>
      </CardContent>
    </Card>
  );
}
