/**
 * Tiny RFC 4180 CSV parser + serializer. Hand-rolled rather
 * than pulling in a dependency because:
 *
 *   - papaparse / csv-parse / d3-dsv all weigh > 50 KB minified
 *     for features we don't use (streams, custom delimiters,
 *     newline detection on huge files)
 *   - the bulk import surface needs a *strict* parse: header
 *     row required, RFC 4180 quoting honored, missing columns
 *     produce typed errors. A general-purpose lib's permissive
 *     defaults would mask malformed operator input
 *
 * Scope:
 *   - `,` is the delimiter (no semicolon-locale support)
 *   - `"` quotes; doubled `""` inside quoted fields = literal `"`
 *   - `\r\n` and `\n` both accepted as row terminators
 *   - empty input → `[]`
 *   - parse returns `Record<string, string>` rows keyed by
 *     header. Caller validates required columns explicitly.
 *
 * Anything fancier (multi-line quoted values with embedded
 * newlines, BOM stripping, type coercion) is deliberately out
 * of scope. Operators producing CSV from spreadsheets get a
 * predictable single-line-per-row contract.
 */

export class CsvParseError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(`CSV line ${line}: ${message}`);
    this.name = "CsvParseError";
  }
}

/**
 * Parse CSV text with a header row. Returns row objects keyed
 * by header column names. Trailing empty lines are ignored.
 *
 * Throws `CsvParseError` on:
 *   - empty input (no header to derive column names)
 *   - rows whose column count differs from the header
 *   - unterminated quoted fields
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) {
    throw new CsvParseError("input is empty (need at least a header row)", 1);
  }
  const header = rows[0]!;
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.length === 1 && row[0] === "") continue; // trailing blank line
    if (row.length !== header.length) {
      throw new CsvParseError(
        `expected ${header.length} columns, got ${row.length}`,
        i + 1,
      );
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]!] = row[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

/**
 * Serialize an array of objects as CSV. The header is taken
 * from the first object's keys (caller-controlled column
 * order). Values are coerced via `String(...)`; null / undefined
 * become empty strings.
 *
 * Quoting policy: a value is wrapped in `"..."` if it contains
 * `,`, `"`, `\r`, or `\n`. Embedded `"` are doubled.
 */
export function serializeCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines: string[] = [headers.map(quoteField).join(",")];
  for (const row of rows) {
    const cells = headers.map((h) => quoteField(stringify(row[h])));
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function quoteField(s: string): string {
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---- Internal: row tokenizer ---------------------------------

function parseRows(text: string): string[][] {
  if (text.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Doubled quote = literal "
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      // Eat \r\n as one terminator
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      line++;
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) {
    throw new CsvParseError("unterminated quoted field", line);
  }

  // Trailing field/row (no newline at EOF)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
