import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, AlertTriangle } from "lucide-react";
import type { SecurityScheme } from "@/lib/api/spec";

/**
 * Server-side security-scheme card. Renders what the cache's
 * OpenAPI spec advertises under `components.securitySchemes` —
 * read-only, scraped from the live spec at server-render time.
 *
 * If the spec doesn't define any schemes (single-node demo
 * cluster, spec stripped intentionally), the card surfaces an
 * informational notice rather than rendering an empty state — an
 * operator might otherwise assume "no auth" rather than "spec
 * incomplete."
 */

export function SchemeCard({
  schemes,
  specVersion,
}: {
  schemes: Record<string, SecurityScheme> | undefined;
  specVersion: string;
}) {
  const entries = schemes ? Object.entries(schemes) : [];

  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
          <KeyRound aria-hidden className="h-4 w-4" />
        </span>
        <div>
          <CardTitle>Server auth scheme</CardTitle>
          <CardDescription>From the cache&apos;s OpenAPI spec — what it expects on the wire.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">
          Spec version <span className="text-foreground font-mono">{specVersion}</span>
        </p>
        {entries.length === 0 ? (
          <p
            role="alert"
            className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-400 ring-1 ring-amber-500/20"
          >
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
            The spec defines no security schemes. Verify the cache is configured with HYPERCACHE_AUTH_TOKEN —
            an empty schemes block is unusual on a production cluster.
          </p>
        ) : (
          <ul role="list" className="space-y-3">
            {entries.map(([name, scheme]) => (
              <li key={name} className="border-border/50 bg-card/50 rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{name}</span>
                  <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10px]">
                    {scheme.type}
                    {scheme.scheme ? ` · ${scheme.scheme}` : ""}
                  </span>
                </div>
                {scheme.bearerFormat && (
                  <p className="text-muted-foreground text-xs">
                    Format: <span className="text-foreground font-mono">{scheme.bearerFormat}</span>
                  </p>
                )}
                {scheme.in && scheme.name && (
                  <p className="text-muted-foreground text-xs">
                    Carried in <span className="text-foreground font-mono">{scheme.in}</span>:{" "}
                    <span className="text-foreground font-mono">{scheme.name}</span>
                  </p>
                )}
                {scheme.description && (
                  <p className="text-muted-foreground mt-2 text-xs whitespace-pre-line">
                    {scheme.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
