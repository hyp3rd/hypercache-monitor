"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";

/**
 * Shared key-list input for the Fetch + Delete tabs. Two ways
 * to populate the textarea:
 *
 *   - paste / type (one key per line)
 *   - upload a `.txt` or `.csv` file — text is read verbatim and
 *     replaces the textarea contents (no append; that's a
 *     surprise the operator wouldn't expect)
 *
 * Lines are trimmed; empty lines and `#`-comment lines are
 * dropped. Returned via the `onKeysChange` callback as the
 * filtered array; the page reads that, not the raw textarea.
 *
 * Why allow comments: operators paste from runbooks with
 * leading `# context: incident-1234` lines. Drop them silently
 * rather than treating them as keys.
 */
export function KeysInput({
  label,
  onKeysChange,
  placeholder = "key-1\nkey-2\nkey-3",
}: {
  label: string;
  onKeysChange: (keys: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleChange(value: string) {
    setText(value);
    onKeysChange(extractKeys(value));
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    handleChange(content);
    // Reset the input so re-uploading the same file fires onChange again.
    event.target.value = "";
  }

  const keyCount = extractKeys(text).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="keys-input"
          className="text-sm font-medium"
        >
          {label}
        </label>
        <p className="text-muted-foreground font-mono text-xs">
          {keyCount.toLocaleString()} {keyCount === 1 ? "key" : "keys"}
        </p>
      </div>
      <Textarea
        id="keys-input"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        rows={8}
        className="font-mono text-sm"
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,text/plain,text/csv"
          onChange={handleFile}
          className="sr-only"
          aria-label="Upload key list"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload
            aria-hidden
            className="mr-1.5 h-3.5 w-3.5"
          />
          Upload .txt
        </Button>
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <FileText
            aria-hidden
            className="h-3 w-3"
          />
          One key per line · `#` lines ignored
        </span>
      </div>
    </div>
  );
}

/**
 * Drop blanks + `#`-prefixed comment lines, trim each remaining
 * line. Exported for unit-testability — the keep-out semantics
 * of comment handling deserve a pinned test.
 */
export function extractKeys(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
