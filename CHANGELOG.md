# Changelog

## 0.1.0 (2026-10-27)

- Initial release.
- CLI: `decisionscope query_decision`, `decisionscope
  list_decision_changes`, `decisionscope whoami`, and
  `decisionscope mcp`.
- MCP server (`decisionscope mcp`, stdio) with three read-only
  tools: `query_decision`, `list_decision_changes`, and `whoami`.
- Forwarding client for the hosted decision-record endpoint named
  by `RITHMO_MCP_URL` (default `https://app.rithmo.ai/api/mcp`).
  Every request carries the per-organization service token from
  `RITHMO_MCP_TOKEN` as a Bearer token; the token must carry the
  `mcp:read` scope. A missing token fails before any request is
  made, naming `RITHMO_MCP_TOKEN`.
- `query_decision` returns the upstream result verbatim, including
  the `found`, `found_record`, and `no_record` variants.
  `list_decision_changes` validates `limit` as an integer in
  1–200 (default 50 upstream) and passes the opaque `since` cursor
  through unchanged. `whoami` takes no arguments and returns the
  upstream `{ org_id, scopes }`.
- All upstream access goes through an injectable fetch function,
  so the test suite runs entirely on fake responses with no
  network.
