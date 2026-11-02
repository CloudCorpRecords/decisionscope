/**
 * decisionscope types.
 *
 * The three tools are thin, typed views over a hosted, read-only
 * decision record. Argument shapes follow the documented Input
 * tables exactly. Result payloads are passed through verbatim from
 * the upstream server, so the result types describe the documented
 * variants without narrowing away fields the record may carry.
 */

/** Restrict a decision query to one record type. */
export type DecisionType = "action_item" | "follow_up" | "decision";

/** Arguments for query_decision. */
export interface QueryDecisionArgs {
  question: string;
  type?: DecisionType;
  owner?: string;
  area?: string;
  surface?: string;
}

/** Arguments for list_decision_changes. */
export interface ListDecisionChangesArgs {
  /** Opaque cursor from a prior call; omit to start from now, "0_" to backfill. */
  since?: string;
  /** Page size, integer 1-200; the upstream default is 50. */
  limit?: number;
}

/** Owner as a discriminated state, never a bare null. */
export type DecisionOwner =
  | { state: "owned"; name: string; user_id: string }
  | { state: "unowned" };

/** Source as a discriminated state, never a bare null. */
export type DecisionSource =
  | { state: "resolved"; system: string; ref: string; url: string }
  | { state: "unresolved" };

/**
 * A query_decision result: a discriminated union on `result`
 * ("found" | "found_record" | "no_record"). The payload is kept
 * open because each variant carries its own documented fields and
 * the record is returned verbatim.
 */
export type QueryDecisionResult = { result: string } & Record<string, unknown>;

/** One entry of a list_decision_changes page. */
export type DecisionChange = Record<string, unknown>;

/** A list_decision_changes page: changes plus the drain cursor. */
export interface ListDecisionChangesResult {
  changes: DecisionChange[];
  cursor: string;
  has_more: boolean;
}

/** whoami result: the organization the token resolves to, and its scopes. */
export interface WhoamiResult {
  org_id: string;
  scopes: string[];
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;

/** Dependencies for a tool call; fetch is injectable for tests. */
export interface CallDeps {
  fetchFn: FetchFn;
  /** Service token; falls back to RITHMO_MCP_TOKEN in `env`. */
  token?: string;
  /** Endpoint override; falls back to RITHMO_MCP_URL in `env`, then the default. */
  baseUrl?: string;
  /** Environment map used for token / URL resolution. Defaults to process.env. */
  env?: Record<string, string | undefined>;
}
