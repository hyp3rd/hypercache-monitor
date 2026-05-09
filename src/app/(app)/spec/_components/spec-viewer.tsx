/**
 * Native OpenAPI 3.x renderer — Phase B5.
 *
 * Replaces an earlier `@scalar/api-reference-react` integration
 * that fought the monitor's design language at every turn (and
 * pulled in 6 moderate DOMPurify XSS advisories via its
 * monaco-editor dependency chain). For an 8-endpoint internal
 * API embedded inside an operator dashboard, hand-rolled with
 * the existing shadcn primitives is both visually consistent
 * and ~smaller-bundle than carrying a docs-site library.
 *
 * Scope: read-only documentation only. Operators who need to
 * invoke endpoints use:
 *   - Single-Key Inspector (`/keys`) for per-key probing
 *   - Bulk operations (`/bulk`) for batched workflows
 * Both already gate destructive ops behind explicit confirms.
 *
 * Server component: this file is rendered by the page server
 * component, no client interactivity needed. The collapsible
 * sections use native `<details>` so we don't pay for
 * "use client" + state management.
 */
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---- Wire shapes ---------------------------------------------------

// Subset of OpenAPI 3.x we render. Anything outside this projection
// passes through untouched in the spec (`filterToSafeMethods` only
// drops write methods); this interface just narrows what the UI
// reads. Loose typing is intentional — the spec arrives as
// `RawSpec` (`Record<string, unknown>`) and we narrow at access sites.

interface OperationLike {
  summary?: unknown;
  description?: unknown;
  operationId?: unknown;
  tags?: unknown;
  parameters?: unknown;
  requestBody?: unknown;
  responses?: unknown;
}

interface ParameterLike {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  description?: unknown;
  schema?: unknown;
}

const RENDERED_METHODS = ["get", "head", "options", "trace"] as const;
type RenderedMethod = (typeof RENDERED_METHODS)[number];

const METHOD_TONE: Record<RenderedMethod, string> = {
  get: "bg-sky-500/10 text-sky-400 ring-sky-500/20",
  head: "bg-violet-500/10 text-violet-400 ring-violet-500/20",
  options: "bg-muted text-muted-foreground ring-border/50",
  trace: "bg-muted text-muted-foreground ring-border/50",
};

// ---- Component -----------------------------------------------------

export function SpecViewer({ spec }: { spec: Record<string, unknown> }) {
  const info = spec["info"] as Record<string, unknown> | undefined;
  const paths = spec["paths"] as
    | Record<string, Record<string, unknown>>
    | undefined;

  const operations = paths ? collectOperations(paths) : [];

  return (
    <div className="space-y-5">
      {info !== undefined && <SpecInfoCard info={info} />}
      {operations.length === 0 ? (
        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">
              No read-only operations defined in this spec.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul
          role="list"
          className="space-y-4"
        >
          {operations.map((op) => (
            <li key={`${op.method}:${op.path}`}>
              <OperationCard op={op} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Subcomponents -------------------------------------------------

function SpecInfoCard({ info }: { info: Record<string, unknown> }) {
  const title = stringOr(info["title"], "API");
  const version = stringOr(info["version"], "");
  const description = stringOr(info["description"], "");
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader>
        {/* Real <h2> — sits under the page's <h1> "API spec" and
            above each operation's <h3> summary. shadcn's CardTitle
            is a <div>, which makes screen-reader navigation by
            heading skip the spec-info / operation hierarchy and
            denies E2E `getByRole('heading', …)` selectors. */}
        <h2 className="flex flex-wrap items-baseline gap-2 text-lg leading-none font-semibold">
          <span>{title}</span>
          {version && (
            <span className="text-muted-foreground font-mono text-xs">
              v{version}
            </span>
          )}
        </h2>
        {description && (
          <CardDescription className="mt-1">{description}</CardDescription>
        )}
      </CardHeader>
    </Card>
  );
}

function OperationCard({ op }: { op: ResolvedOperation }) {
  const parameters = Array.isArray(op.operation.parameters)
    ? (op.operation.parameters as ParameterLike[])
    : [];
  const responses = isRecord(op.operation.responses)
    ? op.operation.responses
    : undefined;

  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide uppercase ring-1 ${METHOD_TONE[op.method]}`}
          >
            {op.method}
          </span>
          <code className="text-foreground font-mono text-sm font-medium break-all">
            {op.path}
          </code>
          {Array.isArray(op.operation.tags) &&
            (op.operation.tags as unknown[])
              .filter((t): t is string => typeof t === "string")
              .map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="font-mono text-[10px]"
                >
                  {tag}
                </Badge>
              ))}
        </div>
        {typeof op.operation.summary === "string" && (
          // Real <h3> — see comment in SpecInfoCard for the reason
          // (CardTitle is a <div>; we want the heading hierarchy
          // page <h1> → spec-info <h2> → per-operation <h3>).
          <h3 className="text-base leading-none font-semibold">
            {op.operation.summary}
          </h3>
        )}
        {typeof op.operation.description === "string" && (
          <CardDescription className="whitespace-pre-line">
            {op.operation.description}
          </CardDescription>
        )}
        {typeof op.operation.operationId === "string" && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium tracking-wide uppercase">
              Operation ID
            </span>{" "}
            <span className="text-foreground font-mono">
              {op.operation.operationId}
            </span>
          </p>
        )}
      </CardHeader>

      {parameters.length > 0 && (
        <>
          <Separator className="bg-border/40" />
          <CardContent className="pt-5">
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              Parameters
            </p>
            <ParametersTable parameters={parameters} />
          </CardContent>
        </>
      )}

      {responses !== undefined && (
        <>
          <Separator className="bg-border/40" />
          <CardContent className="pt-5">
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              Responses
            </p>
            <ResponsesList responses={responses} />
          </CardContent>
        </>
      )}
    </Card>
  );
}

function ParametersTable({ parameters }: { parameters: ParameterLike[] }) {
  return (
    <div className="border-border/50 overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>In</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parameters.map((p, i) => {
            const schema = isRecord(p.schema) ? p.schema : undefined;
            const type =
              schema && typeof schema["type"] === "string"
                ? schema["type"]
                : "—";
            return (
              <TableRow
                key={`${stringOr(p.name, "?")}-${stringOr(p.in, "?")}-${i}`}
              >
                <TableCell className="font-mono text-xs">
                  {stringOr(p.name, "—")}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {stringOr(p.in, "—")}
                </TableCell>
                <TableCell>
                  {p.required === true ? (
                    <Badge
                      variant="default"
                      className="text-[10px]"
                    >
                      required
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      optional
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{type}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {stringOr(p.description, "")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ResponsesList({ responses }: { responses: Record<string, unknown> }) {
  const entries = Object.entries(responses).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <ul
      role="list"
      className="space-y-2"
    >
      {entries.map(([code, value]) => {
        const tone = statusTone(code);
        const description =
          isRecord(value) && typeof value["description"] === "string"
            ? value["description"]
            : "";
        return (
          <li
            key={code}
            className="border-border/50 bg-card/40 flex items-baseline gap-3 rounded-md border p-3"
          >
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ring-1 ${tone}`}
            >
              {code}
            </span>
            <span className="text-foreground text-sm">
              {description || (
                <em className="text-muted-foreground">(no description)</em>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Helpers -------------------------------------------------------

interface ResolvedOperation {
  path: string;
  method: RenderedMethod;
  operation: OperationLike;
}

/**
 * Walks `paths` and produces a flat list of (path, method, op)
 * tuples, sorted by path then by RENDERED_METHODS order so the
 * rendered list is stable across reloads. The filter that drops
 * write methods runs server-side in `filterToSafeMethods` —
 * here we just defensively re-check, in case a future caller
 * passes an unfiltered spec.
 */
function collectOperations(
  paths: Record<string, Record<string, unknown>>,
): ResolvedOperation[] {
  const out: ResolvedOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const method of RENDERED_METHODS) {
      const op = item[method];
      if (!isRecord(op)) continue;
      out.push({ path, method, operation: op as OperationLike });
    }
  }
  return out.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return (
      RENDERED_METHODS.indexOf(a.method) - RENDERED_METHODS.indexOf(b.method)
    );
  });
}

function statusTone(code: string): string {
  // First digit of the response code → tone bucket. `default` and
  // weird codes fall through to muted.
  const lead = code.charAt(0);
  if (lead === "2")
    return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20";
  if (lead === "3") return "bg-sky-500/10 text-sky-400 ring-sky-500/20";
  if (lead === "4") return "bg-amber-500/10 text-amber-400 ring-amber-500/20";
  if (lead === "5") return "bg-rose-500/10 text-rose-400 ring-rose-500/20";
  return "bg-muted text-muted-foreground ring-border/50";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
