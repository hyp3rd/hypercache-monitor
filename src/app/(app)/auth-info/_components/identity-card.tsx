import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCircle2 } from "lucide-react";

/**
 * Operator-identity card. Surfaces the iron-session bound details
 * (clusterId + identity label) but **never** the bearer token —
 * see the page-level docstring for why token exposure is the
 * wrong tradeoff for an audit surface.
 *
 * No client interactivity. Pure server component.
 */
export function IdentityCard({ clusterId, identity }: { clusterId: string; identity: string }) {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
          <UserCircle2 aria-hidden className="h-4 w-4" />
        </span>
        <div>
          <CardTitle>Session identity</CardTitle>
          <CardDescription>Who you are, from the iron-session cookie.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <li className="border-border/50 bg-card/50 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs font-medium">Identity</p>
            <p className="text-foreground mt-1.5 font-mono text-lg font-semibold">{identity}</p>
          </li>
          <li className="border-border/50 bg-card/50 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs font-medium">Active cluster</p>
            <p className="text-foreground mt-1.5 font-mono text-lg font-semibold">{clusterId}</p>
          </li>
        </ul>
        <p className="text-muted-foreground mt-4 text-xs">
          The bearer token sealing this session is HMAC-encrypted in the cookie and intentionally never
          surfaced here — exposing it (even masked) would create a screen-scrape vector.
        </p>
      </CardContent>
    </Card>
  );
}
