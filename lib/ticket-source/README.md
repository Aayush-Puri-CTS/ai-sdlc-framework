# Ticket-Source Adapter Boundary

AI-SDLC-FRAMEWORK-SPEC.md section 8 describes ticket intake as one
abstract workflow with swappable adapters:

**Resolve ticket → Read requirements → Author `docs/specs/<feature>.md`**

This directory is the invariant-core boundary that makes that swap
possible. Everything downstream of the written spec — Implementor,
Verifier, and every hook — is source-agnostic: they read
`docs/specs/<feature>.md`, never the ticket system directly, and never
need to know or care whether that spec came from an MCP connector or a
human pasting text into the terminal. That is the entire point of this
boundary: a team can change ticketing platforms, or fall back to manual
paste on a bad day, without touching anything past this point.

## Who executes this step

Unlike `scripts/validate-config.mjs` or `scripts/scaffold.mjs`, nothing
in this directory is a script you run. MCP tools are called BY an agent
from inside its own tool-use loop — there is no way for a standalone Node
process to invoke them (that would require re-implementing an MCP client
outside Claude Code entirely, which gains nothing here). So this
boundary is implemented as a **behavioral contract for the Coordinator**,
written in Markdown, the same way `agents/coordinator.md` is a contract
rather than a script. The Coordinator reads the relevant adapter doc and
follows it.

## Adapter selection

The Coordinator reads `ticket_source.type` from `project.config.yml`:

- `type: "mcp"` → follow `adapters/mcp.md`. A concrete worked example for
  a Zoho Sprints connector is in `adapters/zoho.md` — copy its
  `ticket_source` block shape if your team also uses Zoho Sprints; if not,
  `adapters/mcp.md` is the platform-agnostic contract to follow for any
  other MCP-connected ticketing tool (Jira, Linear, etc.).
- `type: "manual"` → follow `adapters/manual.md`.

`adapters/manual.md` is also the required fallback any time the `mcp`
adapter cannot resolve a ticket (connector unreachable, ticket ID not
found, required fields missing) — see that doc for when to stop retrying
and ask the human to paste the ticket instead.

## The one invariant: the written spec's shape

Regardless of adapter, the spec written to `docs/specs/<feature>.md` must
follow `templates/SPEC.template.md`'s shape (feature name, source
provenance, autonomy tier classification, acceptance criteria, in-scope
hard rules). That shape — not any particular ticketing platform's schema
— is what the Implementor and Verifier are entitled to assume.

## Least privilege

`ticket_source.read_tools` in `project.config.yml` is validated by
`scripts/validate-config.mjs` (spec section 3, rule 7) to contain only
read-verbed tool names (`Get`/`List`/`Read`), never a write/update/delete
capability. That validation only checks the *declared list* in config —
it does not, by itself, mechanically stop an agent from calling some
*other* tool the connected MCP server happens to expose. Follow the
adapter docs' instruction to call only the tools named in
`ticket_source.read_tools`, and see `docs/CONFORMANCE.md` for this
boundary's current limitation on mechanical (vs. instructional)
enforcement of that restriction.
