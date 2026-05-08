import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scopeCatalog } from "@/lib/auth/scopes";
import type { Scope } from "@/lib/auth/session";
import { ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * Granted-scopes card. Two views:
 *
 *   - Top: chip row of granted scopes with their summaries.
 *   - Bottom: table listing ALL catalog scopes and the concrete
 *     actions each unlocks, with a granted/denied indicator per
 *     row. This gives an operator a one-glance answer to "what
 *     can I do here? what would I need to escalate for?"
 */

const SCOPE_TONE: Record<Scope, string> = {
  read: "bg-sky-500/10 text-sky-400 ring-sky-500/20",
  write: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  admin: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
};

export function ScopesCard({ granted }: { granted: Scope[] }) {
  const grantedSet = new Set(granted);
  const allScopes = Object.keys(scopeCatalog) as Scope[];

  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
          <ShieldCheck aria-hidden className="h-4 w-4" />
        </span>
        <div>
          <CardTitle>Granted scopes</CardTitle>
          <CardDescription>What this session is authorized to do, per the cache server.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {granted.length === 0 ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive ring-destructive/20 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ring-1"
          >
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
            No scopes granted — all cache operations will return 403.
          </p>
        ) : (
          <ul role="list" className="flex flex-wrap gap-2">
            {granted.map((scope) => (
              <li key={scope}>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${SCOPE_TONE[scope]}`}
                >
                  {scopeCatalog[scope].label}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
            Permissions matrix
          </p>
          <ul role="list" className="space-y-3">
            {allScopes.map((scope) => {
              const desc = scopeCatalog[scope];
              const isGranted = grantedSet.has(scope);
              return (
                <li
                  key={scope}
                  className={`border-border/50 rounded-lg border p-3 ${isGranted ? "bg-card/50" : "bg-muted/30 opacity-70"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${SCOPE_TONE[scope]}`}
                        >
                          {desc.label}
                        </span>
                        <span className="text-foreground text-sm">{desc.summary}</span>
                      </div>
                      <ul className="text-muted-foreground mt-2 ml-4 list-disc space-y-0.5 text-xs">
                        {desc.actions.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                        isGranted
                          ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                          : "bg-muted text-muted-foreground ring-border/50"
                      }`}
                    >
                      {isGranted ? "granted" : "denied"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
