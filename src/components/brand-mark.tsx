import { cn } from "@/lib/utils";

/**
 * Brand mark for HyperCache Monitor. Custom SVG: a six-pointed
 * polygon (the consistent-hash ring metaphor) with an inner
 * dot (the "primary" owner). Wrapped in a violet gradient
 * background so the mark reads as a brand without needing a
 * raster logo.
 *
 * Pure CSS + SVG — scales fluidly, recolors with theme tokens,
 * accessible via `aria-label` on the wrapper.
 */
export function BrandMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <span
      role="img"
      aria-label="HyperCache Monitor"
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white",
        "shadow-[0_4px_18px_-4px_oklch(0.55_0.22_295/0.5)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        style={{ width: size * 0.6, height: size * 0.6 }}
      >
        {/* Outer hash ring (hexagon) */}
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" />
        {/* Inner ring */}
        <polygon points="12 7 17 9.5 17 14.5 12 17 7 14.5 7 9.5" opacity="0.5" />
        {/* Primary owner dot */}
        <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      </svg>
    </span>
  );
}
