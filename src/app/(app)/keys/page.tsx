import { activeSession } from "@/lib/auth/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeysClient } from "./_components/keys-client";

export const metadata: Metadata = {
  title: "Keys",
  description: "Inspect, edit, and delete individual cache keys.",
};

/**
 * Single-Key Inspector — Phase B1.
 *
 * Server-component shell. The active key is encoded in the URL
 * search param (`?k=...`) so refresh and back-button work. The
 * client component drives PUT / GET / DELETE / owners through
 * the Next.js proxy via `src/lib/api/keys.ts`.
 *
 * Write scope is verified lazily: the login probe only checks
 * read scope (a successful PUT against a fake key would
 * litter the cluster), so PUT failures here surface as a 403
 * with an inline error rather than a redirect to /login.
 */
interface KeysPageProps {
  searchParams: Promise<{ k?: string | string[] }>;
}

export default async function KeysPage({ searchParams }: KeysPageProps) {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  const params = await searchParams;
  const raw = params.k;
  const initialKey = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
          Cache
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Keys</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Inspect, edit, or delete a single cache key. Use the search box to
          load a key by name; values render with a decode toggle so binary
          payloads stay readable.
        </p>
      </header>
      <KeysClient
        clusterId={auth.clusterId}
        initialKey={initialKey ?? null}
      />
    </div>
  );
}
