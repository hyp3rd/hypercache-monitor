import type { ReactNode } from "react";
import Link from "next/link";
import { Database, Network, BarChart3, Layers, ShieldCheck, FileCode2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClusterPicker } from "@/components/cluster-picker";
import { LogoutButton } from "@/components/logout-button";
import { BrandMark } from "@/components/brand-mark";
import { listClusters } from "@/lib/clusters/registry";
import { activeSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

/**
 * Sidebar + topbar shell that wraps every authenticated route.
 * Phase A nav exposes Topology only; the placeholders for B
 * surfaces are visible but disabled so operators understand
 * the roadmap without us lying about availability.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await activeSession();
  if (!auth) {
    redirect("/login");
  }

  const clusters = listClusters().map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 flex-col border-r border-border/60 bg-card/40 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-5">
          <BrandMark size={32} />
          <div>
            <h2 className="text-sm font-semibold leading-none tracking-tight">HyperCache</h2>
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Monitor</p>
          </div>
        </div>
        <Separator className="bg-border/50" />
        <nav className="flex flex-1 flex-col gap-0.5 p-3" aria-label="Primary navigation">
          <NavSection label="Cluster" />
          <NavLink href="/topology" icon={<Network aria-hidden className="h-4 w-4" />}>
            Topology
          </NavLink>
          <NavLink href="/keys" icon={<Database aria-hidden className="h-4 w-4" />} disabled>
            Keys
          </NavLink>
          <NavLink href="/metrics" icon={<BarChart3 aria-hidden className="h-4 w-4" />} disabled>
            Metrics
          </NavLink>
          <NavLink href="/bulk" icon={<Layers aria-hidden className="h-4 w-4" />} disabled>
            Bulk operations
          </NavLink>
          <div className="mt-2" />
          <NavSection label="Reference" />
          <NavLink href="/auth-info" icon={<ShieldCheck aria-hidden className="h-4 w-4" />} disabled>
            Auth posture
          </NavLink>
          <NavLink href="/spec" icon={<FileCode2 aria-hidden className="h-4 w-4" />} disabled>
            API spec
          </NavLink>
        </nav>
        <div className="border-t border-border/50 p-3 text-[11px] text-muted-foreground">
          <p className="font-mono">v0.1.0 · Phase A</p>
          <p className="mt-1">Read-only Topology surface. Phase B unlocks Keys, Metrics, Bulk.</p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border/60 bg-card/40 px-6 backdrop-blur">
          <ClusterPicker clusters={clusters} activeId={auth.clusterId} identity={auth.session.identity} />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function NavSection({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
      {label}
    </p>
  );
}

function NavLink({
  href,
  icon,
  children,
  disabled,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground/70"
      >
        {icon}
        <span className="flex-1">{children}</span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          B
        </span>
      </span>
    );
  }
  return (
    <Link
      href={href as never}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-foreground/85 transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
      {children}
    </Link>
  );
}
