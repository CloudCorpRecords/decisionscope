# decisionscope — Build Report

MCP Rebuild 1000 (Batch 9). Clean-room rebuild of
Rithmo-Inc/rithmo-mcp-examples (rank 530, 0★, Tier C), built from
the spec in `specs-batch9/rithmo.md`, itself docs-derived from the
original repo's README tool reference (read firsthand 2026-10-27).
The fixture `harness/fixtures/rithmo-mcp-examples-tools-original.json`
is labelled docs-derived with the full documented set of 3 tools;
no original server was probed. Parity proves the rebuild matches
this program's defined spec, labelled docs-derived. Local build
only — nothing pushed or published.

Identity: repo `decisionscope`, npm `@reneturcios/decisionscope`,
MCP name `io.github.CloudCorpRecords/decisionscope`, version
`0.1.0`, bin `decisionscope` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `decisionscope: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Read-only decision record: query
  decisions, drain decision changes, verify token." = **81 chars**
  (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/decisionscope:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/decisionscope"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27)
- `src/index.ts`, `src/cli.ts` (one subcommand per tool, `mcp`,
  `--version`; exit 2 usage / 1 operation error), `src/mcp.ts`,
  `src/types.ts`, `src/decisionscope.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/decisionscope.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to decisionscope)

## Tools implemented (3)

`query_decision`, `list_decision_changes`, `whoami` — the full
documented set. The repo subtitle's `no_record` is **not** a tool:
it is a result variant of `query_decision` (spec: enumeration
governs).

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server`
  (`sdk/server/index.js` + `StdioServerTransport`) with explicit
  inputSchema literals exactly matching the fixture, per the
  standing fleet rule: `McpServer`'s zod-to-JSON-Schema conversion
  injects `$schema` / `additionalProperties` keys absent from the
  defined spec. Zod still validates every `tools/call`.
- Forwarding model: decisionscope is a client for the hosted
  decision-record endpoint. Each call becomes one JSON-RPC
  `tools/call` POST to `RITHMO_MCP_URL` (default
  `https://app.rithmo.ai/api/mcp`) with
  `Authorization: Bearer <RITHMO_MCP_TOKEN>`. The upstream payload
  is returned verbatim — `structuredContent` when present, else a
  parsed JSON text content block — and object results are served
  over MCP as both a JSON text block and `structuredContent`,
  matching the documented consumption pattern
  (`res.structuredContent`). Plain-JSON and SSE (`data:` line)
  upstream replies are both unwrapped; HTTP failures and JSON-RPC
  errors are thrown as errors. The record's own `no_record`
  outcome is a result, never an error.
- Credential discipline: argument validation runs first, then the
  token check, then the request. A missing or blank
  `RITHMO_MCP_TOKEN` fails with an error naming the env var and
  stating that no request was sent (tests assert the fake fetch
  was never called). In the CLI, validation precedes the
  credential check too: bad arguments exit 2 even with no token
  set; a valid call with no token exits 1.
- `query_decision`: `question` is a required non-empty string;
  `type` is validated against the documented enum
  (`action_item` | `follow_up` | `decision`); `owner`, `area`,
  and `surface` are optional non-empty strings. Only provided
  fields are forwarded. The `found` / `found_record` /
  `no_record` variants are passed through untouched, including a
  `found_record` whose `subject.currentAnswer` is null.
- `list_decision_changes`: `since` is opaque and forwarded
  unchanged; `limit` must be an integer in 1–200 and is rejected,
  never clamped (boundaries 1 and 200 accepted; 0, 201, 1.5, −3
  rejected in tests). Omitted `since` / `limit` are not sent, so
  the upstream semantics hold: first call starts from now, and
  the upstream default limit (50) applies.
- `whoami`: takes no arguments (any argument is a validation
  error) and returns the upstream `{ org_id, scopes }`.
- All upstream access goes through an injectable `FetchFn`
  (types.ts), so tests run entirely on fake responses — no live
  network call was made and none is claimed.

## Verification (foreground, exact outputs)

### 1. Typecheck and build
```
$ ./node_modules/.bin/tsc --noEmit ; echo exit=$?
exit=0
$ npm run build   # tsc -> dist/, including dist/cli.js
exit=0
```

### 2. Tests
```
$ npm test   # tsx --test test/*.test.ts
ℹ tests 19
ℹ pass 19
ℹ fail 0
```
Covers, on fake fetch only: token/URL resolution (trim, blank,
default, self-hosted override); missing token naming
`RITHMO_MCP_TOKEN` with zero requests sent; validation before
the credential check; `query_decision` forwarding (one POST, one
`tools/call` body, Bearer header, exact forwarded arguments) with
the `found` payload returned verbatim; optional filters omitted
when not provided and forwarded when provided; `found_record`
with null `currentAnswer` unchanged; bad `type` rejected;
`list_decision_changes` page passthrough, first-call empty
arguments, and limit rejection/boundaries; `whoami` result and
no-argument enforcement; HTTP 401 and JSON-RPC error surfacing;
SSE reply unwrapping; text-block JSON fallback when
`structuredContent` is absent; endpoint/token taken from the env
map; unknown tool rejected before any request.

### 3. CLI / MCP smoke
`--version` → `0.1.0` (exit 0); no args and unknown command print
Usage and exit 2; `list_decision_changes --limit 999` exits 2;
`whoami` with `RITHMO_MCP_TOKEN` unset exits 1 with the token
error; `query_decision` with no question and no token exits 2
(validation first). MCP `initialize` over stdio →
`serverInfo: {"name":"decisionscope","version":"0.1.0"}`;
`tools/list` returned exactly the 3 tools; a stdio `tools/call`
for `whoami` with no token returned `isError: true` with text
naming `RITHMO_MCP_TOKEN`, and no upstream request was attempted.
No live upstream call was made or claimed: no real token exists
in this VM.

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/rithmo-mcp-examples-tools-original.json \
    --rebuild "stdio:node <abs path>/builds/decisionscope/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/decisionscope/parity-out
verdict=PASS parity_pct=100.0 original_tools=3 rebuild_tools=3 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 3/3.) Original side is tools-file
mode, so `fixture_results` records `SKIPPED-TOOLS-FILE-MODE` —
expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was generated clean via Route 3: a temp copy
holding only `package.json` (no `node_modules`, no `dist`),
offline `npm install --package-lock-only --ignore-scripts
--offline`, verified after generation — parses as JSON,
top-level `name` is `@reneturcios/decisionscope`, version
`0.1.0`, `lockfileVersion` 3, **128 package entries** — then only
the lockfile was copied back. Local `node_modules` is a symlink
to the burnmeter sibling's tree, used only for the local
build/test; it is gitignored and not part of the lockfile
generation.

## Spec ambiguities resolved

- **Token env var name:** the assignment's parenthetical mentioned
  `RITHMO_API_TOKEN`, but the spec (`.env.example` per the README)
  names it `RITHMO_MCP_TOKEN`. Followed the spec:
  `RITHMO_MCP_TOKEN`, with the endpoint in `RITHMO_MCP_URL`.
- **`limit` schema encoding:** the spec's Input table documents
  `limit` as integer, 1–200, default 50, with out-of-range values
  rejected rather than clamped. The fixture and the served schema
  encode that as `{type: "integer", minimum: 1, maximum: 200,
  default: 50}`; forwarding omits an unset `limit` so the upstream
  default applies.
- **Forwarding wire format:** the spec documents the upstream as
  a hosted MCP server but not its HTTP framing. The rebuild
  forwards as JSON-RPC `tools/call` over HTTP POST (the standard
  streamable-HTTP MCP shape) and accepts both plain-JSON and SSE
  replies. This is unproven against the live service — see gaps.
- **`whoami` on the CLI** takes no flags at all; any extra
  argument is a usage error (exit 2), mirroring its no-argument
  tool contract.

## Gaps / honest notes

- Docs-derived spec: the README documents the 3 tool names, their
  Input tables, and the output variants, so parity proves the
  rebuild matches this program's defined spec (tool names + exact
  input schemas), not a hand-probed original. Result payloads are
  forwarded verbatim precisely because the record owns their
  shape; the rebuild adds no interpretation of its own beyond the
  documented gating guidance in the README.
- No live upstream behaviour is proven: no real Rithmo token or
  endpoint was available in this VM, so the forwarding wire format
  (JSON-RPC over POST, JSON/SSE unwrap, `structuredContent`
  preference) is a documented reconstruction, exercised only
  against fake fetch responses shaped like the documented
  contract.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
