# MCP Adapter — Generic Contract

Applies when `ticket_source.type == "mcp"` in `project.config.yml`. This
doc is platform-agnostic by design — it must work whether the connector
is Jira, Linear, Zoho, or anything else exposed as an MCP server. Never
add a platform-specific tool name to this file; a concrete worked example
belongs in its own `adapters/<platform>.md` (see `adapters/zoho.md`).

## Steps

1. **Identify the allowlist.** Read `ticket_source.mcp_connector` and
   `ticket_source.read_tools` from `project.config.yml`. `read_tools` is
   the complete set of tools you may call for this step — not a
   suggestion, not a starting point to expand from if you find the
   connected MCP server exposes more.
2. **Resolve the ticket.** Using only the tools in `read_tools`, fetch the
   ticket/item's core details (title, description, status) from whatever
   identifier the human gave you (an ID, a URL, a search term).
3. **Read requirements.** Fetch whatever this connector uses to hold
   acceptance criteria or requirements — a dedicated field if the platform
   has one, or the description/comments if it doesn't. Ticketing tools
   vary widely here; use the read-only tools available to look at
   comments, linked items, or parent epics if the ticket's own description
   is thin. Do not guess at requirements the ticket doesn't state.
4. **Author the spec.** Write `docs/specs/<feature>.md` following
   `templates/SPEC.template.md`. Record the ticket's identifier/URL in the
   spec's provenance field so a human can trace it back later — but the
   spec's *content* must stand on its own; the Implementor and Verifier
   will not re-fetch the ticket.

## When to stop and fall back

Stop and switch to `adapters/manual.md` rather than improvising if:

- The MCP connector is unreachable or errors on every call you're allowed
  to make.
- The ticket identifier the human gave you doesn't resolve.
- What you can read is insufficient to write acceptance criteria you're
  confident in (don't write a spec with acceptance criteria you invented
  to fill a gap — ask the human to paste the ticket text instead).

## Least privilege

Call only the tools listed in `ticket_source.read_tools`. If the
connected MCP server exposes a write/update/delete tool alongside your
allowed read tools, do not call it as part of ticket intake — that
capability existing on the connector is not the same as this step being
authorized to use it. This is currently an instruction you follow, not
something a hook mechanically blocks — see `docs/CONFORMANCE.md` for that
gap and its current mitigation (config-time validation that the
*declared* list is read-only).
