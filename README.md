# decisionscope

decisionscope gives a tool read-only access to a hosted decision
record: a system of record for what was actually decided. Before
acting, a tool can ask the record a natural-language question —
"Are we still shipping the new onboarding flow?" — and get back
the current authoritative answer, or an explicit hold when the
record has no confident answer. A polling caller can also drain
decisions whose state changed since a cursor. The record only
answers; it never takes actions in your systems.

decisionscope is a forwarding client. It runs locally as a CLI
and a stdio MCP server, and forwards each call to the hosted
endpoint as a JSON-RPC `tools/call` request. The endpoint is named
by `RITHMO_MCP_URL` and defaults to the hosted service at
`https://app.rithmo.ai/api/mcp`; a self-hosted deployment exposes
the same tools and contract at its own address.

## Setup

Every request carries a per-organization service token as a
Bearer token. The token resolves to exactly one organization,
must carry the `mcp:read` scope, and every result is scoped to
that organization. There is no anonymous access.

```bash
export RITHMO_MCP_TOKEN="<your service token>"
# Optional; only needed for a self-hosted endpoint:
export RITHMO_MCP_URL="https://app.rithmo.ai/api/mcp"
```

Keep the token in a secret store, never in code. With no token
set, every call fails before any request is sent, with an error
naming `RITHMO_MCP_TOKEN`.

## Install

```bash
npx @reneturcios/decisionscope whoami
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/decisionscope
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead, and pass the two environment
variables above with `-e` so the container can reach your record.

## CLI

```bash
decisionscope query_decision "Are we still shipping the new onboarding flow?"
decisionscope query_decision "What did we decide about GitHub integration?" --type decision
decisionscope query_decision "Who owns the pricing change?" --owner "Priya" --surface jira
decisionscope list_decision_changes
decisionscope list_decision_changes --since "0_" --limit 200
decisionscope whoami

decisionscope --version
```

Results print as JSON. Exit codes: `0` on success, `1` on an
operation error (including a missing token), `2` for usage
errors. Arguments are validated before the token is checked, so a
malformed call is always a usage error.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio
MCP server:

```bash
npx -y @reneturcios/decisionscope mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "decisionscope": {
      "command": "npx",
      "args": ["-y", "@reneturcios/decisionscope", "mcp"],
      "env": {
        "RITHMO_MCP_TOKEN": "<your service token>"
      }
    }
  }
}
```

Object results are returned as a JSON text block and as
`structuredContent`, so clients can read
`res.structuredContent` directly.

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `query_decision` | `question` (required); optional `type` (`action_item` \| `follow_up` \| `decision`), `owner`, `area`, `surface` | A result discriminated on `result`: `found`, `found_record`, or `no_record` — see below. |
| `list_decision_changes` | optional `since` (opaque cursor), optional `limit` (integer 1–200, default 50) | `{ changes, cursor, has_more }` — the changes since the cursor, in `(changed_at, decision_id)` order. |
| `whoami` | (none) | `{ org_id, scopes }` for the configured token. |

### Reading a `query_decision` result

The `result` field has three variants, and the distinction
matters:

- `found` — a live answer from the commitment ledger. The answer
  text is at `answer`, alongside `status`, `lifecycle_state`,
  `owner` and `source` (both discriminated states, never bare
  nulls), `decided_at`, `due_at`, `rationale`, `conditions`,
  `director`, `context`, a `supersedes` chain (newest-first,
  cycle-guarded, capped at 12 hops), an optional `spine`, and a
  `confidence` score. Apart from `confidence`, a `found` result
  for the same decision is byte-identical on every call.
- `found_record` — a live answer from the subject record. This is
  an answer, not a refusal. The answer text is at
  `subject.currentAnswer`, **not** `answer` — and it may be
  `null`, meaning the subject is on record but there is no answer
  text to act on.
- `no_record` — no confident answer. The bare form is just
  `{ "result": "no_record" }`; a typed form adds a `record`
  explaining why the answer is held (`closed`, `no_record`, or
  `not_observed` when the asked-about surface is one the record
  does not observe). A `premise_check`, when present, always has
  `safe_to_proceed: false`. Never proceed on a `no_record`.

Gate on a usable answer, not on the variant name:

```js
const r = res.structuredContent;
const answer =
  r.result === 'found'        ? r.answer :
  r.result === 'found_record' ? r.subject.currentAnswer :
  null;
if (answer != null && String(answer).trim() !== '') { /* act */ }
else { /* hold — no answer to act on */ }
```

One special case: a `no_record` whose `record.reason` starts
with `record_unavailable:` means the record itself could not be
read (a transient failure). That is not "we decided no" — hold
and retry.

### Draining changes

`list_decision_changes` is built for a polling trigger:

- First call (no `since`): returns no changes and the current
  head cursor. You start from now; history is not replayed. Pass
  `since: "0_"` to backfill from the start instead.
- `has_more` means the page was full (`changes.length ===
  limit`). It can be true on an exactly-full final page, so the
  next call may legitimately return zero changes — that is how
  the drain terminates, not an error.
- When a page returns no rows, the cursor is echoed back
  unchanged, so re-polling with it is safe and idempotent.
- Each change carries the same record core as a `found` result,
  plus `changed_at` — but never `supersedes`, `spine`, or
  `confidence`. Its `status` is wider: reversals appear as
  `dropped` or `superseded`, values a `found` result never
  returns.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch only)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
