"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";

/**
 * Bearer-token login form. The token is POSTed to
 * `/api/auth/login`, which validates against the upstream cache,
 * seals an iron-session cookie, and redirects to `/topology`.
 * The token NEVER lives in client state past the single fetch.
 */
export function LoginForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
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
