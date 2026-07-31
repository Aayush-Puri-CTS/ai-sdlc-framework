# Manual Adapter — Always-Available Fallback

Applies when `ticket_source.type == "manual"` in `project.config.yml`,
**and** as the required fallback from `adapters/mcp.md` any time the MCP
adapter cannot resolve a ticket. This adapter has no connector to be
unreachable and no credentials to expire — it is the one path that must
always work, which is why the framework treats it as always available
regardless of what `ticket_source.type` says.

## Steps

1. Ask the human to paste the raw ticket text (title, description,
   acceptance criteria, any relevant comments) directly into the prompt.
2. Do not "clean up" or reinterpret the requirements beyond formatting —
   your job here is transcription into the standard shape, not judgment
   about what the ticket *should* have said.
3. Author `docs/specs/<feature>.md` following `templates/SPEC.template.md`.
   Set the provenance field to `manual paste` (plus a date) rather than a
   ticket ID, since there's no ticket record to trace back to.
4. If the pasted text is missing something the spec template requires
   (e.g. no stated acceptance criteria at all), ask the human for it
   rather than inventing it — an empty or vague acceptance-criteria
   section is a worse outcome than one more round-trip.

## Why this exists even when `ticket_source.type == "mcp"`

MCP connectors have failure modes a framework cannot fully insulate
against: expired credentials, an outage, a ticket that was moved or
deleted, a connector that was never configured for a new project yet.
None of those should stall the whole pipeline. `adapters/mcp.md`
explicitly instructs the Coordinator to fall back here rather than retry
indefinitely or guess.
