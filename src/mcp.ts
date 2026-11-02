/**
 * decisionscope MCP server. Tools: query_decision,
 * list_decision_changes, whoami.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * This server is a forwarding client: every call is forwarded to
 * the hosted endpoint named by RITHMO_MCP_URL (default
 * https://app.rithmo.ai/api/mcp) with the RITHMO_MCP_TOKEN service
 * token as a Bearer token. A missing token is an isError result
 * naming RITHMO_MCP_TOKEN, returned before any request is sent.
 * Object payloads are returned both as a JSON text block and as
 * structuredContent, matching how the documented contract is
 * consumed (`res.structuredContent`).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  callDecisionscopeTool,
  formatPayload,
  resolveToken,
  VERSION,
} from "./decisionscope.js";
import type { FetchFn } from "./types.js";

const QueryDecision = z.object({
  question: z.string(),
  type: z.enum(["action_item", "follow_up", "decision"]).optional(),
  owner: z.string().optional(),
  area: z.string().optional(),
  surface: z.string().optional(),
});
const ListDecisionChanges = z.object({
  since: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const Whoami = z.object({});

const TOOLS = [
  {
    name: "query_decision",
    description:
      "Look up the current authoritative decision for a natural-language question. Returns a found, found_record, or no_record result.",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string" as const, description: "The natural-language question to look up a decision for." },
        type: {
          type: "string" as const,
          enum: ["action_item", "follow_up", "decision"],
          description: "Restrict to records of this type: action item, follow-up, or decision.",
        },
        owner: { type: "string" as const, description: "Restrict to records owned by this person." },
        area: { type: "string" as const, description: "Restrict to records in this area." },
        surface: { type: "string" as const, description: "Restrict to records from this surface." },
      },
      required: ["question"],
    },
  },
  {
    name: "list_decision_changes",
    description:
      "List decisions whose state changed since an opaque cursor, for polling. Omit since to start from now; pass \"0_\" to backfill from the start.",
    inputSchema: {
      type: "object" as const,
      properties: {
        since: { type: "string" as const, description: "Opaque cursor from a previous call; omit to start from now, or pass \"0_\" to backfill from the start." },
        limit: { type: "integer" as const, minimum: 1, maximum: 200, default: 50, description: "Maximum number of changes to return." },
      },
      required: [] as string[],
    },
  },
  {
    name: "whoami",
    description:
      "Return the organization and scopes for the configured service token: { org_id, scopes }.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
];

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  query_decision: QueryDecision,
  list_decision_changes: ListDecisionChanges,
  whoami: Whoami,
};

function resultPayload(value: unknown) {
  const base = {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : formatPayload(value),
      },
    ],
  };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return {
      ...base,
      structuredContent: value as Record<string, unknown>,
    };
  }
  return base;
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "decisionscope", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const schema = SCHEMAS[name];
  if (!schema) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  try {
    const parsed = schema.parse(args ?? {}) as Record<string, unknown>;
    const out = await callDecisionscopeTool(
      {
        fetchFn,
        token: resolveToken(process.env),
        baseUrl: process.env.RITHMO_MCP_URL,
      },
      name,
      parsed,
    );
    return resultPayload(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
