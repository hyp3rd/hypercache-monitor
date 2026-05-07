import type { Metadata } from "next";
import { LoginForm } from "./_components/login-form";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Authenticate against a HyperCache cluster",
};

export default function LoginPage() {
  return (
    <main className="grid-backdrop bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Soft brand glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(80%_60%_at_50%_30%,oklch(0.55_0.22_295/0.18),transparent_60%)]"
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size={56} className="brand-glow" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">HyperCache Monitor</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Operator control panel for distributed cache clusters.
          </p>
        </div>
        <LoginForm />
        <p className="text-muted-foreground mt-6 text-center text-xs">
          Tokens are issued out-of-band by your cluster operator.{" "}
          <span className="font-mono">HYPERCACHE_AUTH_CONFIG</span> defines available identities.
        </p>
      </div>
    </main>
  );
}
