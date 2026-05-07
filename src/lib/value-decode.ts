/**
 * Helpers for decoding the base64 `value` field on
 * `ItemEnvelope`. Pure functions, no React / DOM
 * dependencies — Vitest exercises them directly.
 *
 * The cache's wire shape is always base64 in the JSON
 * envelope (see `itemEnvelope.value_encoding === "base64"`),
 * so the UI must always decode at least once. For binary
 * payloads we surface the bytes as-is via download; for
 * text we attempt UTF-8 decoding and fall back to a hex
 * view when bytes don't round-trip cleanly.
 */

/**
 * Decode the base64 payload to a Uint8Array. Throws on
 * malformed input — call sites should display the raw
 * envelope value as a fallback in that case.
 */
export function decodeBase64(value: string): Uint8Array {
  // atob is the shortest path in browsers; Node has it too
  // since v18. We tolerate URL-safe variants (the cache
  // shouldn't emit them, but be liberal in what we accept).
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * UTF-8 decode that returns null when the bytes contain
 * unpaired surrogates / invalid sequences. We use
 * `fatal: true` on TextDecoder so non-text payloads fall
 * out to the hex / download views rather than rendering
 * garbage U+FFFD characters.
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Format bytes as a hex dump suitable for monospace
 * rendering. 16 bytes per row; offset on the left, hex in
 * the middle, ASCII gloss on the right (printable bytes
 * only, otherwise "."). Pure string output — the consumer
 * decides whether to wrap it in <pre>.
 */
export function toHexDump(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return rows.join("\n");
}

/**
 * Build a `Blob` from the decoded bytes for the Download
 * tab. Caller wires it into `URL.createObjectURL` + an `<a
 * download>` click. Defaults to application/octet-stream so
 * the browser doesn't try to render a possibly-malicious
 * payload inline.
 */
export function bytesToBlob(bytes: Uint8Array, type = "application/octet-stream"): Blob {
  // Copy into a fresh ArrayBuffer (slice() preserves the
  // bytes but returns a plain ArrayBuffer rather than the
  // ArrayBufferLike union). Without the copy, TypeScript
  // narrows `bytes.buffer` to `ArrayBuffer | SharedArrayBuffer`
  // and SharedArrayBuffer isn't a BlobPart.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}
