#!/usr/bin/env node
/**
 * decisionscope CLI.
 *
 *   decisionscope query_decision <question> [--type <t>] [--owner <o>] [--area <a>] [--surface <s>]
 *   decisionscope query_decision --question <question> [--type <t>] [--owner <o>] [--area <a>] [--surface <s>]
 *   decisionscope list_decision_changes [--since <cursor>] [--limit <n>]
 *   decisionscope whoami
 *   decisionscope mcp
 *   decisionscope --version
 *
 * Endpoint from RITHMO_MCP_URL (default https://app.rithmo.ai/api/mcp);
 * service token from RITHMO_MCP_TOKEN, sent as a Bearer token.
 * Argument validation runs before any credential check.
 * Exit codes: 0 success, 1 operation error, 2 usage error.
 */
import {
  buildForwardArguments,
  callDecisionscopeTool,
  formatPayload,
  TOKEN_ENV,
  URL_ENV,
  VERSION,
} from "./decisionscope.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  decisionscope query_decision <question> [--type <action_item|follow_up|decision>] [--owner <name>] [--area <hint>] [--surface <system>]
  decisionscope list_decision_changes [--since <cursor>] [--limit <1-200>]
  decisionscope whoami
  decisionscope mcp
  decisionscope --version

Endpoint: ${URL_ENV} (default https://app.rithmo.ai/api/mcp).
Token: ${TOKEN_ENV} (per-organization service token, scope mcp:read).`);
  process.exit(2);
}

/** Parse "--flag value" pairs; returns null on a dangling flag. */
function flagMap(rest: string[]): Map<string, string> | null {
  const map = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key.startsWith("--") || i + 1 >= rest.length) return null;
    map.set(key, rest[i + 1]);
  }
  return map;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const known = ["query_decision", "list_decision_changes", "whoami"];
  if (!known.includes(cmd)) usage();

  // Build and validate arguments BEFORE any credential check:
  // invalid arguments are a usage error (exit 2), never a token error.
  let args: Record<string, unknown> = {};
  try {
    if (cmd === "query_decision") {
      const positional: string[] = [];
      const flagArgs: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].startsWith("--")) {
          flagArgs.push(rest[i], rest[i + 1] ?? "");
          i++;
        } else {
          positional.push(rest[i]);
        }
      }
      if (positional.length > 1) usage();
      const flags = flagMap(flagArgs);
      if (!flags) usage();
      const allowed = new Set(["--question", "--type", "--owner", "--area", "--surface"]);
      for (const key of flags.keys()) if (!allowed.has(key)) usage();
      const question = flags.get("--question") ?? positional[0];
      if (question !== undefined) args.question = question;
      if (flags.has("--type")) args.type = flags.get("--type");
      if (flags.has("--owner")) args.owner = flags.get("--owner");
      if (flags.has("--area")) args.area = flags.get("--area");
      if (flags.has("--surface")) args.surface = flags.get("--surface");
    } else if (cmd === "list_decision_changes") {
      const flags = flagMap(rest);
      if (!flags) usage();
      const allowed = new Set(["--since", "--limit"]);
      for (const key of flags.keys()) if (!allowed.has(key)) usage();
      if (flags.has("--since")) args.since = flags.get("--since");
      if (flags.has("--limit")) {
        const raw = flags.get("--limit") as string;
        if (!/^-?\d+$/.test(raw)) usage();
        args.limit = Number(raw);
      }
    } else {
      if (rest.length) usage();
    }
    args = buildForwardArguments(cmd, args);
  } catch {
    usage();
  }

  const fetchFn = globalThis.fetch as unknown as FetchFn;
  try {
    const out = await callDecisionscopeTool({ fetchFn }, cmd, args);
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
