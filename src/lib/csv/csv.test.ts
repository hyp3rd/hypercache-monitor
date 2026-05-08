import { describe, expect, it } from "vitest";
import { CsvParseError, parseCsv, serializeCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    const csv = "key,value\nfoo,bar\nbaz,qux";
    expect(parseCsv(csv)).toEqual([
      { key: "foo", value: "bar" },
      { key: "baz", value: "qux" },
    ]);
  });

  it("handles \\r\\n line endings (Windows)", () => {
    const csv = "key,value\r\nfoo,bar\r\nbaz,qux";
    expect(parseCsv(csv)).toEqual([
      { key: "foo", value: "bar" },
      { key: "baz", value: "qux" },
    ]);
  });

  it("ignores trailing blank lines", () => {
    const csv = "key,value\nfoo,bar\n\n";
    expect(parseCsv(csv)).toEqual([{ key: "foo", value: "bar" }]);
  });

  it("respects RFC 4180 quoting for fields containing commas", () => {
    const csv = 'key,value\nfoo,"hello, world"';
    expect(parseCsv(csv)).toEqual([{ key: "foo", value: "hello, world" }]);
  });

  it("respects RFC 4180 doubled-quote escape inside quoted fields", () => {
    const csv = 'key,value\nfoo,"she said ""hi"""';
    expect(parseCsv(csv)).toEqual([{ key: "foo", value: 'she said "hi"' }]);
  });

  it("preserves an empty value as empty string", () => {
    expect(parseCsv("key,value\nfoo,")).toEqual([{ key: "foo", value: "" }]);
  });

  it("throws on empty input (no header to derive columns)", () => {
    expect(() => parseCsv("")).toThrow(CsvParseError);
  });

  it("throws when a row's column count differs from the header", () => {
    expect(() => parseCsv("a,b,c\n1,2")).toThrow(/expected 3 columns, got 2/);
  });

  it("throws on unterminated quoted field", () => {
    expect(() => parseCsv('a,b\nfoo,"unterminated')).toThrow(/unterminated quoted field/);
  });

  it("preserves the operator-controlled header order in returned objects", () => {
    const rows = parseCsv("ttl,key,value\n30000,foo,bar");
    expect(Object.keys(rows[0]!)).toEqual(["ttl", "key", "value"]);
  });
});

describe("serializeCsv", () => {
  it("returns empty string for empty input (caller decides what an empty download means)", () => {
    expect(serializeCsv([])).toBe("");
  });

  it("derives the header from the first row's keys", () => {
    const csv = serializeCsv([
      { key: "foo", value: "bar" },
      { key: "baz", value: "qux" },
    ]);
    expect(csv).toBe("key,value\r\nfoo,bar\r\nbaz,qux");
  });

  it("quotes values containing commas / quotes / newlines", () => {
    const csv = serializeCsv([
      { key: "with,comma", value: "plain" },
      { key: 'with "quotes"', value: "still plain" },
      { key: "with\nnewline", value: "plain" },
    ]);
    expect(csv).toBe(
      'key,value\r\n"with,comma",plain\r\n"with ""quotes""",still plain\r\n"with\nnewline",plain',
    );
  });

  it("coerces null / undefined to empty strings", () => {
    const csv = serializeCsv([{ a: null, b: undefined, c: 0 }]);
    expect(csv).toBe("a,b,c\r\n,,0");
  });

  it("round-trips clean ASCII content via parse + serialize", () => {
    const original = [
      { key: "k1", value: "v1" },
      { key: "k2", value: "v,with comma" },
      { key: "k3", value: 'v"with quote' },
    ];
    const parsed = parseCsv(serializeCsv(original));
    expect(parsed).toEqual(original);
  });
});
