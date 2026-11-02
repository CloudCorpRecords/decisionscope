/**
 * decisionscope core: a forwarding client for a hosted, read-only
 * decision record.
 *
 * The upstream server is a hosted MCP endpoint. Each tool call here
 * becomes exactly one JSON-RPC `tools/call` POST to the endpoint
 * named by RITHMO_MCP_URL (default https://app.rithmo.ai/api/mcp),
 * carrying the per-organization service token from RITHMO_MCP_TOKEN
 * as `Authorization: Bearer <token>`. The token must carry the
 * `mcp:read` scope; every result is scoped to the token's
 * organization. There is no anonymous access.
 *
 * Rules honoured here, from the documented contract:
 * - Argument validation runs before the credential check, and the
 *   credential check runs before any request: a missing or blank
 *   token fails with an error naming RITHMO_MCP_TOKEN and no
 *   request is ever sent.
 * - `query_decision` returns the upstream payload verbatim. Its
 *   `result` field discriminates "found" (answer at `answer`),
 *   "found_record" (answer at `subject.currentAnswer`, which may
 *   be null), and "no_record" (a held answer, never an error).
 *   Callers must gate on a usable answer, not on the variant name.
 * - `list_decision_changes` validates `limit` as an integer in
 *   1-200 and rejects out-of-range or non-integer values instead
 *   of clamping; the `since` cursor is opaque and passed through
 *   unchanged. When the caller omits `limit`, it is not sent, so
 *   the upstream default (50) applies; the same holds for `since`
 *   (omit on the first call to start from now; "0_" backfills).
 * - `whoami` takes no arguments and returns `{ org_id, scopes }`.
 *
 * The upstream reply may be a plain JSON-RPC body or an SSE stream
 * (`data:` lines); both are unwrapped. A result's
 * `structuredContent` wins when present; otherwise a JSON text
 * content block is parsed; otherwise the raw result is returned.
 * HTTP failures and JSON-RPC errors are thrown as errors — the
 * record's own `no_record` outcome is a result, not an error.
 *
 * All HTTP goes through an injected FetchFn so the request
 * shaping is fully testable offline with fake responses.
 */
import type {
  CallDeps,
  DecisionType,
  ListDecisionChangesArgs,
  QueryDecisionArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const TOKEN_ENV = "RITHMO_MCP_TOKEN";
export const URL_ENV = "RITHMO_MCP_URL";
export const DEFAULT_BASE_URL = "https://app.rithmo.ai/api/mcp";
export const REQUIRED_SCOPE = "mcp:read";

export const TOOL_NAMES = [
  "query_decision",
  "list_decision_changes",
  "whoami",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const DECISION_TYPES: readonly string[] = ["action_item", "follow_up", "decision"];

/** Read the service token out of an environment map. */
export function resolveToken(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = typeof env[TOKEN_ENV] === "string" ? env[TOKEN_ENV].trim() : "";
  return raw ? raw : undefined;
}

/** Resolve the endpoint: explicit value, then RITHMO_MCP_URL, then the hosted default. */
export function resolveBaseUrl(
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = (explicit ?? env[URL_ENV] ?? DEFAULT_BASE_URL).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

function reqString(args: Record<string, unknown>, field: string): string {
  const v = args[field];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return v;
}

function optString(args: Record<string, unknown>, field: string): string | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${field} must be a non-empty string when provided`);
  }
  return v;
}

/** Validate query_decision arguments and shape the forwarded arguments. */
export function buildQueryDecisionArgs(
  args: Record<string, unknown>,
): QueryDecisionArgs {
  const out: QueryDecisionArgs = { question: reqString(args, "question") };
  const type = args.type;
  if (type !== undefined) {
    if (typeof type !== "string" || !DECISION_TYPES.includes(type)) {
      throw new Error(
        `type must be one of ${DECISION_TYPES.join(", ")} when provided`,
      );
    }
    out.type = type as DecisionType;
  }
  const owner = optString(args, "owner");
  if (owner !== undefined) out.owner = owner;
  const area = optString(args, "area");
  if (area !== undefined) out.area = area;
  const surface = optString(args, "surface");
  if (surface !== undefined) out.surface = surface;
  return out;
}

/** Validate list_decision_changes arguments and shape the forwarded arguments. */
export function buildListDecisionChangesArgs(
  args: Record<string, unknown>,
): ListDecisionChangesArgs {
  const out: ListDecisionChangesArgs = {};
  const since = args.since;
  if (since !== undefined) {
    if (typeof since !== "string" || !since) {
      throw new Error("since must be a non-empty string when provided");
    }
    out.since = since;
  }
  const limit = args.limit;
  if (limit !== undefined) {
    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new Error("limit must be an integer between 1 and 200");
    }
    out.limit = limit;
  }
  return out;
}

/** Validate whoami arguments (none are accepted) and shape the forwarded arguments. */
export function buildWhoamiArgs(args: Record<string, unknown>): Record<string, never> {
  if (Object.keys(args ?? {}).length > 0) {
    throw new Error("whoami takes no arguments");
  }
  return {};
}

/** Validate one tool's arguments and return the arguments to forward. */
export function buildForwardArguments(
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const a = args ?? {};
  switch (tool) {
    case "query_decision":
      return { ...buildQueryDecisionArgs(a) };
    case "list_decision_changes":
      return { ...buildListDecisionChangesArgs(a) };
    case "whoami":
      return { ...buildWhoamiArgs(a) };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a response body that may be plain JSON or an SSE stream of JSON-RPC messages. */
function parseRpcBody(bodyText: string): Record<string, unknown> {
  const trimmed = bodyText.trim();
  if (!trimmed) throw new Error("upstream returned an empty response body");
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) return parsed;
    throw new Error("upstream returned a non-object JSON response");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("upstream returned")) throw err;
    // Fall through to SSE parsing.
  }
  let last: Record<string, unknown> | undefined;
  for (const line of trimmed.split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m || !m[1].trim()) continue;
    try {
      const parsed: unknown = JSON.parse(m[1]);
      if (isRecord(parsed)) last = parsed;
    } catch {
      // A non-JSON data line is not an RPC message; keep scanning.
    }
  }
  if (last) return last;
  throw new Error("upstream response was neither JSON nor an SSE stream of JSON-RPC messages");
}

/** Extract the tool payload from a JSON-RPC response envelope. */
function unwrapResult(rpc: Record<string, unknown>, url: string): unknown {
  if (isRecord(rpc.error)) {
    const message =
      typeof rpc.error.message === "string" ? rpc.error.message : "unknown upstream error";
    throw new Error(`upstream tools/call to ${url} failed: ${message}`);
  }
  const result = rpc.result;
  if (!isRecord(result)) return result;
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text) as unknown;
        } catch {
          return block.text;
        }
      }
    }
  }
  return result;
}

/** Generic entry point used by the MCP server and the CLI. */
export async function callDecisionscopeTool(
  deps: CallDeps,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Argument validation first, before any credential check.
  const forwardArgs = buildForwardArguments(tool, args ?? {});
  const env = deps.env ?? process.env;
  const token = (typeof deps.token === "string" ? deps.token.trim() : "") || resolveToken(env);
  if (!token) {
    throw new Error(
      `${TOKEN_ENV} is not set: a per-organization service token with the ${REQUIRED_SCOPE} scope is required (sent as a Bearer token). No request was sent.`,
    );
  }
  const url = resolveBaseUrl(deps.baseUrl, env);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: forwardArgs },
  });
  let response;
  try {
    response = await deps.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (err) {
    throw new Error(
      `request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const bodyText = await response.text();
  if (!response.ok) {
    const detail = bodyText.trim() ? `: ${bodyText.trim().slice(0, 200)}` : "";
    throw new Error(`upstream ${url} returned HTTP ${response.status}${detail}`);
  }
  return unwrapResult(parseRpcBody(bodyText), url);
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
