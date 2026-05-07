"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";

/**
 * Cache-key lookup form. The cache has no list/scan endpoint
 * (every read is by exact key), so this is just an input +
 * submit — no autocomplete suggestions to render. The
 * submitted value lifts to the URL search param.
 *
 * Keys can carry any UTF-8 character (see
 * `cmd/hypercache-server/openapi.yaml`'s PathKey schema, which
 * allows 1-1024 bytes); we don't validate beyond non-empty
 * because the cache itself rejects malformed input with a
 * stable BAD_REQUEST.
 */
export function KeySearch({
  initialKey,
  onSubmit,
}: {
  initialKey: string;
  onSubmit: (next: string | null) => void;
}) {
  const [value, setValue] = useState(initialKey);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    onSubmit(trimmed === "" ? null : trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label
          htmlFor="key-input"
          className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
        >
          Key name
        </Label>
        <Input
          id="key-input"
          type="text"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="user:42:session"
          className="font-mono"
        />
      </div>
      <Button type="submit" className="w-full gap-2" disabled={value.trim() === ""}>
        <Search aria-hidden className="h-4 w-4" />
        Inspect
      </Button>
    </form>
  );
}
