"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClusterListItem } from "@/lib/clusters/types";
import { KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Bearer-token login form. The token is POSTed to
 * `/api/auth/login`, which validates against the upstream cache,
 * seals an iron-session cookie, and redirects to `/topology`.
 * The token NEVER lives in client state past the single fetch.
 *
 * Phase C1: when the registry has >1 cluster the form prepends a
 * cluster `<Select>` and sends `{ token, clusterId }`. With a
 * single cluster the dropdown is omitted entirely (rendering and
 * accessibility tree match the Phase A/B form exactly), and the
 * single cluster id rides along in the body — login route already
 * defaults to it but sending it explicitly keeps the wire format
 * uniform across single- and multi-cluster deployments.
 */
export function LoginForm({
  clusters,
  preselectedClusterId,
}: {
  clusters: ClusterListItem[];
  preselectedClusterId: string | undefined;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedClusterId, setSelectedClusterId] = useState<string | undefined>(
    preselectedClusterId ?? clusters[0]?.id,
  );

  const showClusterPicker = clusters.length > 1;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          selectedClusterId !== undefined ? { token, clusterId: selectedClusterId } : { token },
        ),
      });

      // Wipe the token from local state regardless of outcome.
      setToken("");

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Sign-in failed (${response.status})`);
        return;
      }

      router.replace("/topology");
      router.refresh();
    });
  }

  return (
    <Card className="border-border/50 bg-card/60 shadow-2xl shadow-violet-500/5 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <KeyRound aria-hidden className="text-primary h-4 w-4" />
          Sign in with bearer token
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form id="login-form" onSubmit={onSubmit} className="space-y-4">
          {showClusterPicker && (
            <div className="space-y-2">
              <Label
                htmlFor="cluster"
                className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              >
                Cluster
              </Label>
              <Select
                value={selectedClusterId}
                onValueChange={(v) => setSelectedClusterId(v)}
                disabled={pending}
              >
                <SelectTrigger id="cluster" className="w-full" aria-label="Cluster">
                  <SelectValue placeholder="Select a cluster" />
                </SelectTrigger>
                <SelectContent>
                  {clusters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-xs">{c.id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label
              htmlFor="token"
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
            >
              Token
            </Label>
            <Input
              id="token"
              type="password"
              autoComplete="off"
              autoFocus
              required
              minLength={1}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-invalid={error !== null}
              aria-describedby={error ? "login-error" : undefined}
              placeholder="••••••••••••••••••••••••"
              className="font-mono"
            />
          </div>
          {error !== null && (
            <p
              id="login-error"
              className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1"
              role="alert"
            >
              {error}
            </p>
          )}
        </form>
      </CardContent>
      <CardFooter>
        <Button
          form="login-form"
          type="submit"
          disabled={pending || token.length === 0}
          className="w-full gap-2"
        >
          {pending ? (
            <>
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Verifying…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
