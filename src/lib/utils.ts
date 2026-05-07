import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` is the canonical class-name composer for shadcn/ui — it
 * filters out falsy values via clsx, then de-duplicates conflicting
 * Tailwind utilities via tailwind-merge so the rightmost utility
 * always wins. Imported by every component that takes a `className`
 * prop. Don't reach for `clsx` or `twMerge` directly — let `cn`
 * be the single seam.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
