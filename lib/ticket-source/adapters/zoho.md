# MCP Adapter — Zoho Sprints Worked Example

A concrete instance of `adapters/mcp.md` for teams whose ticket source is
a Zoho Sprints MCP connector. This is example content, not core — if your
team uses a different connector, use `adapters/mcp.md` directly and write
your own `adapters/<platform>.md` alongside this one rather than editing
this file.

## `project.config.yml` block

```yaml
ticket_source:
  type: "mcp"
  mcp_connector: "Zoho-Sprints-CTS"
  read_tools:
    - "ZohoSprints_GetItems"
    - "ZohoSprints_GetItemDetails"
    - "ZohoSprints_GetItemComments"
    - "ZohoSprints_GetEpicDetails"
```

All four are `Get`-verbed, so they pass `scripts/validate-config.mjs`'s
read-only check unmodified. Zoho Sprints' MCP surface also exposes
`GetSprints`, `GetProjects`, `GetLinkedItems`, `GetTagsAssociatedWithItem`,
and others — add whichever ones this team's tickets actually need
(e.g. add `ZohoSprints_GetLinkedItems` if requirements are frequently
split across linked items). Every one of those is also read-only; none of
Zoho Sprints' write-capable tools (create/update item, log hours, etc.)
should ever appear in this list.

## Resolve flow

1. **Identify the item.** The human will usually give you an item ID or a
   sprint/project + item title. Use `ZohoSprints_GetItems` to search
   within a project/sprint if you only have a title, or go straight to
   `ZohoSprints_GetItemDetails` if you have the ID.
2. **Read requirements.** Zoho Sprints doesn't have a dedicated
   "acceptance criteria" field the way some ticketing tools do —
   requirements are typically written into the item's description, or
   clarified across `ZohoSprints_GetItemComments`. Read both; don't stop
   at the description if the comments contain clarifications that change
   scope.
3. **Check for parent context.** If the item belongs to an epic,
   `ZohoSprints_GetEpicDetails` often carries broader context (why this
   work exists, what else it's blocked on) that the item alone won't
   state. Use it when the item's own description assumes context you
   don't have.
4. **Author the spec.** Write `docs/specs/<feature>.md` per
   `templates/SPEC.template.md`. Record the Zoho Sprints item ID (and
   project/sprint) as the provenance — not a URL if Zoho Sprints doesn't
   expose a stable one your team relies on.

## Fallback

If `ZohoSprints_GetItemDetails` returns nothing for a given ID, or the
description + comments genuinely don't state clear acceptance criteria,
follow `adapters/manual.md` — ask the human to paste the ticket text
rather than inventing criteria to fill the gap.
