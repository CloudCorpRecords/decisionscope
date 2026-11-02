import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildForwardArguments,
  callDecisionscopeTool,
  DEFAULT_BASE_URL,
  resolveBaseUrl,
  resolveToken,
} from "../src/decisionscope.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

/**
 * Fake-fetch tests only: no live network, no live token. The fake
 * captures every request so tests can assert the URL, the Bearer
 * header, and the forwarded JSON-RPC body, and returns canned
 * JSON-RPC envelopes shaped like the documented upstream replies.
 */

interface Captured {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function jsonResponse(body: unknown, status = 200): HttpResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: () => null },
    text: async () => text,
  };
}

function rpcResult(payload: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    },
  };
}

function fakeFetch(response: HttpResponse | (() => HttpResponse)) {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  return { calls, fetchFn };
}

const FOUND = {
  result: "found",
  answer: "Ship the new onboarding flow behind a flag.",
  status: "in_progress",
  lifecycle_state: "confirmed",
  owner: { state: "owned", name: "Priya", user_id: "u_1" },
  source: { state: "resolved", system: "meeting", ref: "m-42", url: "https://example.test/m-42" },
  decided_at: "2026-10-20T15:00:00.000Z",
  due_at: null,
  rationale: "Activation dropped on the old flow.",
  conditions: null,
  director: null,
  context: null,
  supersedes: null,
  spine: null,
  confidence: 0.71,
};

describe("resolveToken / resolveBaseUrl", () => {
  it("trims the token, treats blank as unset, defaults the URL", () => {
    assert.equal(resolveToken({ RITHMO_MCP_TOKEN: "  tok  " }), "tok");
    assert.equal(resolveToken({ RITHMO_MCP_TOKEN: "   " }), undefined);
    assert.equal(resolveToken({}), undefined);
    assert.equal(resolveBaseUrl(undefined, {}), DEFAULT_BASE_URL);
    assert.equal(
      resolveBaseUrl(undefined, { RITHMO_MCP_URL: "https://self.example.test/api/mcp/" }),
      "https://self.example.test/api/mcp",
    );
    assert.equal(resolveBaseUrl("https://explicit.test/mcp", {}), "https://explicit.test/mcp");
  });
});

describe("missing token", () => {
  it("fails naming RITHMO_MCP_TOKEN before any request is sent", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult({ org_id: "o", scopes: [] })));
    await assert.rejects(
      callDecisionscopeTool({ fetchFn, env: {} }, "whoami", {}),
      /RITHMO_MCP_TOKEN is not set/,
    );
    assert.equal(calls.length, 0);
  });

  it("argument validation runs before the credential check", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult({})));
    await assert.rejects(
      callDecisionscopeTool({ fetchFn, env: {} }, "query_decision", {}),
      /question must be a non-empty string/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("query_decision", () => {
  it("forwards one tools/call POST with the Bearer token and returns found verbatim", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult(FOUND)));
    const out = await callDecisionscopeTool(
      { fetchFn, token: "svc-token", env: {} },
      "query_decision",
      { question: "Are we still shipping the new onboarding flow?", type: "decision" },
    );
    assert.deepEqual(out, FOUND);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DEFAULT_BASE_URL);
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.headers?.Authorization, "Bearer svc-token");
    const body = JSON.parse(calls[0].init?.body as string) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    assert.equal(body.method, "tools/call");
    assert.equal(body.params.name, "query_decision");
    assert.deepEqual(body.params.arguments, {
      question: "Are we still shipping the new onboarding flow?",
      type: "decision",
    });
  });

  it("omits optional filters that were not provided", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult({ result: "no_record" })));
    const out = await callDecisionscopeTool(
      { fetchFn, token: "t", env: {} },
      "query_decision",
      { question: "Anything decided about pricing?" },
    );
    assert.deepEqual(out, { result: "no_record" });
    const body = JSON.parse(calls[0].init?.body as string) as {
      params: { arguments: Record<string, unknown> };
    };
    assert.deepEqual(body.params.arguments, { question: "Anything decided about pricing?" });
  });

  it("passes a found_record with a null currentAnswer through unchanged", async () => {
    const payload = {
      result: "found_record",
      subject: { subjectId: "s1", label: "Pricing", state: "open", currentAnswer: null },
    };
    const { fetchFn } = fakeFetch(jsonResponse(rpcResult(payload)));
    const out = await callDecisionscopeTool(
      { fetchFn, token: "t", env: {} },
      "query_decision",
      { question: "What is the pricing decision?" },
    );
    assert.deepEqual(out, payload);
  });

  it("rejects an unknown type value before any request", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult({})));
    await assert.rejects(
      callDecisionscopeTool(
        { fetchFn, token: "t", env: {} },
        "query_decision",
        { question: "q", type: "reminder" },
      ),
      /type must be one of action_item, follow_up, decision/,
    );
    assert.equal(calls.length, 0);
  });

  it("forwards owner, area, and surface filters when provided", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult({ result: "no_record" })));
    await callDecisionscopeTool(
      { fetchFn, token: "t", env: {} },
      "query_decision",
      { question: "q", owner: "priya", area: "billing", surface: "jira" },
    );
    const body = JSON.parse(calls[0].init?.body as string) as {
      params: { arguments: Record<string, unknown> };
    };
    assert.deepEqual(body.params.arguments, {
      question: "q",
      owner: "priya",
      area: "billing",
      surface: "jira",
    });
  });
});

describe("list_decision_changes", () => {
  it("forwards since and limit and returns the page unchanged", async () => {
    const page = {
      changes: [
        { decision_id: "d1", answer: "a", status: "superseded", changed_at: "2026-10-21T00:00:00.000Z" },
      ],
      cursor: "174_c1",
      has_more: false,
    };
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult(page)));
    const out = await callDecisionscopeTool(
      { fetchFn, token: "t", env: {} },
      "list_decision_changes",
      { since: "0_", limit: 200 },
    );
    assert.deepEqual(out, page);
    const body = JSON.parse(calls[0].init?.body as string) as {
      params: { arguments: Record<string, unknown> };
    };
    assert.deepEqual(body.params.arguments, { since: "0_", limit: 200 });
  });

  it("rejects out-of-range and non-integer limits instead of clamping", () => {
    for (const bad of [0, 201, 1.5, -3]) {
      assert.throws(
        () => buildForwardArguments("list_decision_changes", { limit: bad }),
        /limit must be an integer between 1 and 200/,
      );
    }
    assert.deepEqual(buildForwardArguments("list_decision_changes", { limit: 1 }), { limit: 1 });
    assert.deepEqual(buildForwardArguments("list_decision_changes", { limit: 200 }), { limit: 200 });
    assert.deepEqual(buildForwardArguments("list_decision_changes", {}), {});
  });

  it("sends no arguments on a first call with no cursor", async () => {
    const { calls, fetchFn } = fakeFetch(
      jsonResponse(rpcResult({ changes: [], cursor: "999_head", has_more: false })),
    );
    const out = (await callDecisionscopeTool(
      { fetchFn, token: "t", env: {} },
      "list_decision_changes",
      {},
    )) as { changes: unknown[]; cursor: string; has_more: boolean };
    assert.deepEqual(out.changes, []);
    assert.equal(out.cursor, "999_head");
    assert.equal(out.has_more, false);
    const body = JSON.parse(calls[0].init?.body as string) as {
      params: { arguments: Record<string, unknown> };
    };
    assert.deepEqual(body.params.arguments, {});
  });
});

describe("whoami", () => {
  it("returns org_id and scopes and forwards no arguments", async () => {
    const { calls, fetchFn } = fakeFetch(
      jsonResponse(rpcResult({ org_id: "org_123", scopes: ["mcp:read"] })),
    );
    const out = await callDecisionscopeTool({ fetchFn, token: "t", env: {} }, "whoami", {});
    assert.deepEqual(out, { org_id: "org_123", scopes: ["mcp:read"] });
    const body = JSON.parse(calls[0].init?.body as string) as {
      params: { name: string; arguments: Record<string, unknown> };
    };
    assert.equal(body.params.name, "whoami");
    assert.deepEqual(body.params.arguments, {});
  });

  it("rejects arguments for whoami", () => {
    assert.throws(() => buildForwardArguments("whoami", { x: 1 }), /whoami takes no arguments/);
  });
});

describe("upstream failures and reply shapes", () => {
  it("surfaces an HTTP 401 as an error naming the status", async () => {
    const { fetchFn } = fakeFetch(jsonResponse("unauthorized", 401));
    await assert.rejects(
      callDecisionscopeTool({ fetchFn, token: "bad", env: {} }, "whoami", {}),
      /HTTP 401/,
    );
  });

  it("surfaces a JSON-RPC error message", async () => {
    const { fetchFn } = fakeFetch(
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "token lacks mcp:read" } }),
    );
    await assert.rejects(
      callDecisionscopeTool({ fetchFn, token: "t", env: {} }, "whoami", {}),
      /token lacks mcp:read/,
    );
  });

  it("unwraps an SSE-streamed reply", async () => {
    const sse =
      "event: message\ndata: " +
      JSON.stringify(rpcResult({ org_id: "org_9", scopes: ["mcp:read"] })) +
      "\n\n";
    const { fetchFn } = fakeFetch(jsonResponse(sse));
    const out = await callDecisionscopeTool({ fetchFn, token: "t", env: {} }, "whoami", {});
    assert.deepEqual(out, { org_id: "org_9", scopes: ["mcp:read"] });
  });

  it("parses a JSON text content block when structuredContent is absent", async () => {
    const { fetchFn } = fakeFetch(
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: JSON.stringify({ result: "no_record" }) }] },
      }),
    );
    const out = await callDecisionscopeTool(
      { fetchFn, token: "t", env: {} },
      "query_decision",
      { question: "q" },
    );
    assert.deepEqual(out, { result: "no_record" });
  });

  it("uses the endpoint from RITHMO_MCP_URL when no override is passed", async () => {
    const { calls, fetchFn } = fakeFetch(
      jsonResponse(rpcResult({ org_id: "o", scopes: ["mcp:read"] })),
    );
    await callDecisionscopeTool(
      { fetchFn, env: { RITHMO_MCP_TOKEN: "env-tok", RITHMO_MCP_URL: "https://self.test/api/mcp" } },
      "whoami",
      {},
    );
    assert.equal(calls[0].url, "https://self.test/api/mcp");
    assert.equal(calls[0].init?.headers?.Authorization, "Bearer env-tok");
  });

  it("rejects an unknown tool before any request", async () => {
    const { calls, fetchFn } = fakeFetch(jsonResponse(rpcResult({})));
    await assert.rejects(
      callDecisionscopeTool({ fetchFn, token: "t", env: {} }, "delete_decision", {}),
      /Unknown tool: delete_decision/,
    );
    assert.equal(calls.length, 0);
  });
});
