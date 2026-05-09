import { describe, expect, it } from "vitest";
import {
  bytesToBlob,
  decodeBase64,
  decodeUtf8,
  toHexDump,
} from "./value-decode";

/**
 * Pure-function tests for the value-decode helpers. The
 * Single-Key Inspector renders cache values across four
 * representations (Text, Hex, Base64, Download), all of
 * which feed off these primitives. Coverage here is what
 * keeps the inspector's value display honest when payloads
 * cross the binary / text boundary.
 */

describe("decodeBase64", () => {
  it("decodes a vanilla ASCII payload", () => {
    const out = decodeBase64("aGVsbG8="); // "hello"
    expect(Array.from(out)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it("decodes an empty string to empty bytes", () => {
    expect(decodeBase64("").length).toBe(0);
  });

  it("tolerates URL-safe variants (-/_) and missing padding", () => {
    // "subjects?" → standard base64 has slashes/pluses;
    // operators sometimes emit URL-safe by mistake. We
    // accept either.
    const out = decodeBase64("c3ViamVjdHM_"); // missing pad + URL-safe `_`
    expect(decodeUtf8(out)).toBe("subjects?");
  });

  it("throws on garbage input", () => {
    expect(() => decodeBase64("not~valid~base64!!")).toThrow();
  });
});

describe("decodeUtf8", () => {
  it("returns the string for valid UTF-8 bytes", () => {
    const bytes = new Uint8Array([0xe2, 0x9c, 0x93]); // ✓
    expect(decodeUtf8(bytes)).toBe("✓");
  });

  it("returns null for invalid UTF-8 sequences", () => {
    // Lone continuation byte is invalid UTF-8.
    const bytes = new Uint8Array([0x80]);
    expect(decodeUtf8(bytes)).toBeNull();
  });

  it("returns the empty string for empty input", () => {
    expect(decodeUtf8(new Uint8Array())).toBe("");
  });
});

describe("toHexDump", () => {
  it("formats one line per 16 bytes with offset / hex / ASCII gloss", () => {
    const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const dump = toHexDump(bytes);
    expect(dump).toContain("00000000");
    expect(dump).toContain("68 65 6c 6c 6f");
    expect(dump).toContain("hello");
  });

  it("renders non-printable bytes as `.` in the ASCII gloss", () => {
    const bytes = new Uint8Array([0x00, 0x1f, 0x80, 0xff]);
    const dump = toHexDump(bytes);
    expect(dump).toContain("00 1f 80 ff");
    expect(dump).toContain("....");
  });

  it("returns the empty string for empty input", () => {
    expect(toHexDump(new Uint8Array())).toBe("");
  });
});

describe("bytesToBlob", () => {
  it("produces a Blob whose byte content matches the input", async () => {
    const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const blob = bytesToBlob(bytes);
    expect(blob.size).toBe(5);
    expect(blob.type).toBe("application/octet-stream");
    const roundtrip = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(roundtrip)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it("honors a custom mime type", () => {
    const blob = bytesToBlob(new Uint8Array(), "text/plain");
    expect(blob.type).toBe("text/plain");
  });
});
