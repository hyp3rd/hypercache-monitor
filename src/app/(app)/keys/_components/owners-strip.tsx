"use client";

/**
 * Renders the ring-owners array as a small chip row. The
 * primary owner (first entry) gets the brand color; replicas
 * are muted. Operators glance at this to confirm the key
 * landed where they expected.
 */
export function OwnersStrip({
  owners,
  node,
}: {
  owners: string[];
  node: string;
}) {
  if (owners.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">No ring owners reported.</p>
    );
  }
  return (
    <ul
      aria-label="Ring owners"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      {owners.map((owner, i) => {
        const isPrimary = i === 0;
        const isHandler = owner === node;
        return (
          <li key={owner}>
            <span
              className={
                isPrimary
                  ? "bg-brand-muted text-primary ring-primary/30 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono font-medium ring-1"
                  : "bg-muted/50 text-muted-foreground ring-border/50 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono ring-1"
              }
            >
              {isPrimary && (
                <span
                  aria-label="primary"
                  title="primary owner"
                  className="text-[10px] tracking-wider uppercase opacity-80"
                >
                  P
                </span>
              )}
              <span>{owner}</span>
              {isHandler && (
                <span
                  aria-label="handled this request"
                  title="this node served the request"
                  className="text-[10px] tracking-wider opacity-70"
                >
                  ←
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
