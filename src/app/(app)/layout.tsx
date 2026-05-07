import { BrandMark } from "@/components/brand-mark";
import { ClusterPicker } from "@/components/cluster-picker";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { activeSession } from "@/lib/auth/session";
import { listClusters } from "@/lib/clusters/registry";
import { BarChart3, Database, FileCode2, Layers, Network, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

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
    <div className="bg-background flex min-h-screen">
      <aside className="border-border/60 bg-card/40 flex w-60 flex-col border-r backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-5">
          <BrandMark size={32} />
          <div>
            <h2 className="text-sm leading-none font-semibold tracking-tight">HyperCache</h2>
            <p className="text-muted-foreground mt-1 text-[11px] tracking-[0.18em] uppercase">Monitor</p>
          </div>
        </div>
        <Separator className="bg-border/50" />
        <nav className="flex flex-1 flex-col gap-0.5 p-3" aria-label="Primary navigation">
          <NavSection label="Cluster" />
          <NavLink href="/topology" icon={<Network aria-hidden className="h-4 w-4" />}>
            Topology
          </NavLink>
          <NavLink href="/keys" icon={<Database aria-hidden className="h-4 w-4" />}>
            Keys
          </NavLink>
          <NavLink href="/metrics" icon={<BarChart3 aria-hidden className="h-4 w-4" />}>
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
        <div className="border-border/50 text-muted-foreground border-t p-3 text-[11px]">
          <p className="font-mono">v0.3.0 · Phase B (in progress)</p>
          <p className="mt-1">
            Single-Key Inspector and Metrics live. Bulk, Auth posture, Spec viewer to follow.
          </p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="border-border/60 bg-card/40 flex h-16 items-center justify-between border-b px-6 backdrop-blur">
          <ClusterPicker clusters={clusters} activeId={auth.clusterId} identity={auth.session.identity} />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>
        {/* tabIndex=0 puts the scrollable main into the keyboard
         * tab order, satisfying axe-core's
         * `scrollable-region-focusable` rule. After tabbing to
         * the region, keyboard users press arrow keys to scroll
         * long pages — the WCAG-prescribed pattern. tabIndex=-1
         * isn't enough; the rule explicitly requires the region
         * to be reachable via Tab. */}
        <main tabIndex={0} aria-label="Main content" className="flex-1 overflow-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavSection({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground/80 px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase">
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
        className="text-muted-foreground/70 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm"
      >
        {icon}
        <span className="flex-1">{children}</span>
        <span className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase">
          B
        </span>
      </span>
    );
  }
  return (
    <Link
      href={href as never}
      className="text-foreground/85 hover:bg-accent hover:text-accent-foreground flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    >
      {icon}
      {children}
    </Link>
  );
}
