# AI-SDLC Framework Specification

### (Refactored Enterprise Edition)

This is the authoritative specification for turning a single-team AI-assisted software development lifecycle (SDLC) setup into an opinionated, reusable, enterprise-grade framework that teams across the organization (mobile, backend, web, and infrastructure) vendor into their own repositories.

The framework guarantees deterministic runtime governance, complete separation of duties, mechanically audited hard rules, while allowing team-specific build environments, repository conventions, and risk thresholds to be fully configurable.

---

## 1. Design Principle: Three Layers, Cleanly Separated

The framework strictly enforces separation of concerns across three operational layers to decouple platform governance logic from repository-level implementation scripts.

| Layer                      | Description                                                                                                                                 | Ship Location                               | Maintainer / Owner                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| **Invariant Core**         | CIV topology, hook contracts, permission schema shapes, autonomy tier definitions, rule taxonomy, schema validators                         | Shared framework repo (`ai-sdlc-framework`) | Framework / Platform Engineering  |
| **Team-Authored Content**  | Actual hard rule statements, repository coding conventions, architectural decision triggers, custom instructions (`CLAUDE.md`, `REVIEW.md`) | Consuming application repository            | Product Engineering Team          |
| **Team-Supplied Bindings** | Executable build/test shell commands, file globs, permission paths, issue tracking adapters (`project.config.yml`)                          | Consuming application repository            | Repository Maintainer / Tech Lead |

Opinionated on structure, thin on content. The framework dictates the schema, tier ladder, lifecycle hook contracts, and rule taxonomy. It does not dictate what a team's specific rules say. Different stacks (e.g., Android Gradle vs. Node.js pnpm) maintain unique configurations, yet platform teams can uniformly audit and govern every consuming repo.

---

## 2. The CIV Topology and Context Architecture

Autonomy is controlled by restricting agent capabilities at the tool and lifecycle layers rather than relying on prompt instructions.

### Agent Roles and Capability Separation

Three sub-agents execute sequentially per task:

- **COORDINATOR** (Model: Claude Opus, main conversation thread)
  - Classifies autonomy tiers (A–E).
  - Cuts feature branches and writes task specifications under `docs/specs/*.md`.
  - Owns git state (the only agent permitted to execute git commits and open PRs).
  - Delegates implementation to the Implementor and verification to the Verifier.

- **IMPLEMENTOR** (Model: Claude Sonnet)
  - Capabilities: Read/Write/Edit/Bash/Grep/Glob.
  - Authors application code and co-located unit tests per task specification.
  - Blocked from Git: Mechanically prevented from running state-changing git commands via hook interception.
  - Reports task completion back to the Coordinator.

- **VERIFIER** (Model: Claude Sonnet)
  - Capabilities: Read/Bash/Grep/Glob (Write/Edit tools explicitly omitted).
  - Re-runs build, linting, and verification commands; audits hard governance rules.
  - Cannot modify source code to force tests to pass.
  - Returns a structured verdict: PASS or FAIL with detailed diagnostic findings.

### Per-Task Execution Loop

1. **Classification & Delegation:** Coordinator evaluates task risk tier, writes `docs/specs/<task-name>.md`, and delegates execution to the Implementor.
2. **Implementation:** Implementor writes code and tests inside an ephemeral workspace window. Implementor reports completion to the Coordinator (cannot self-approve or commit).
3. **Verification:** Coordinator delegates validation to the Verifier. Verifier executes checks and audits static/judgment rules.
4. **Commit / Remediation:**
   - On PASS, the Coordinator executes a commit (`(<task-name>): <what changed>`).
   - On FAIL, the Coordinator re-delegates the task to the Implementor alongside the Verifier's structured failure report.
5. **Pull Request:** Coordinator opens a single PR only after all task specifications pass verification.

### Context Management and Persistence

To prevent context saturation and token inflation during long-running tasks, the framework enforces:

- **Ephemeral Sub-Agent Context Windows:** Tool execution logs, intermediate shell outputs, and diffs remain trapped within sub-agent context windows, keeping the main Coordinator thread clean.
- **Automated Context Compaction:** When sub-agent context windows approach threshold boundaries, compaction routines preserve active task specs (`docs/specs/*.md`), configuration parameters, and touched file manifests while truncating raw terminal outputs.
- **Session Resumption Anchors:** Operational state is recorded under `.claude/hooks/.state/`, allowing interrupted or gated tasks to resume without re-processing prior tool chains.

---

## 3. The Config Contract — `project.config.yml`

This is the load-bearing artifact. All hooks, templates, and CLI scripts read directly from it at runtime. Build commands exist strictly in this file—never duplicate command strings into `CLAUDE.md` or hook bodies.

```yaml
# project.config.yml
version: 1

team:
  name: "mobile-engineering"
  git_remote: "git@github.com:enterprise/mobile-app.git"
  default_branch_prefix: "feat/"

stack:
  package_manager: "gradle"
  lint_cmd: "./gradlew ktlintCheck --file {file}"
  test_cmd: "./gradlew test --tests {base}Test"
  extra_validate_cmd: "./gradlew detekt"
  flags:
    no_install: true # Enforces --no-install during hook checks to prevent unauthorized package downloads

verify_hook:
  include_glob: "app/src/**/*.kt"
  test_pattern: "{base}Test.kt"
  skip_globs:
    - "**/*.md"
    - "**/generated/**"
    - "**/build/**"
  loop_budget: 3 # Failure threshold before escalating to human review

hard_rules:
  - id: "no-live-data"
    statement: "No connections to live/production endpoints or databases."
    audit: static
    review_gate: blocking
  - id: "no-pii-in-logs"
    statement: "No PII or sensitive account details written to analytics or console logs."
    audit: verifier
    review_gate: blocking
  - id: "enforce-design-tokens"
    statement: "UI components must consume design system tokens instead of raw hex values."
    audit: static
    review_gate: advisory

tiers:
  D_triggers:
    - "public API contract change"
    - "new native permission request"
    - "database schema or migration modification"
  E_triggers:
    - "production environment secrets or deployment key modification"
    - "store release configuration changes"
  C_needs_reviewer: "mobile-architecture-team"

permissions:
  deny_read:
    - "**/*.keystore"
    - "**/*.p12"
    - "**/secrets/**"
    - ".env*"
  deny_cmd_patterns:
    - "fastlane deploy"
    - "pod trunk push"
    - "rm -rf /"
    - "./gradlew publish"
  ask_cmd_patterns:
    - "git push"
    - "./gradlew assembleRelease"
  ask_write_paths:
    - "**/AndroidManifest.xml"
    - "**/Info.plist"
  allow_write_paths:
    - "app/src/**"

ticket_source:
  type: "mcp"
  mcp_connector: "Jira-Enterprise-Connector"
  read_tools:
    - "Jira_GetIssue"
    - "Jira_ListComments"
    - "Jira_GetAcceptanceCriteria"

observability:
  enabled: true
  collector_endpoint: "https://otel-collector.enterprise.internal:4318/v1/traces"
  service_name: "ai-sdlc-mobile-app"
  sample_rate: 1.0
```

### Schema Validation Rules (`scripts/validate-config.mjs`)

The configuration validator enforces strict schema rules during setup and CI execution:

1. `version` must equal `1`.
2. Every item in `hard_rules[]` must explicitly define `id`, `statement`, `audit ∈ {static, verifier}`, and `review_gate ∈ {blocking, advisory}`.
3. `loop_budget` must be a positive integer (`1 ≤ loop_budget ≤ 5`).
4. `stack.flags.no_install` must evaluate to `true` to block mid-session package downloads.
5. `tiers.D_triggers` and `tiers.E_triggers` must contain at least one non-empty string.
6. If `ticket_source.type == "mcp"`, `mcp_connector` and `read_tools` must be non-empty.
7. `read_tools` must strictly contain read-only verbs (Get/List/Read)—the validator rejects any tool containing write or update capabilities.

---

## 4. Config-Driven Lifecycle Hooks and Execution Engine

Runtime governance is driven by a deterministic lifecycle hook engine.

### Hook Event Matrix and Exit Code Discipline

| Event                 | Checkpoint Trigger Condition                    | Handler Action                                                                                                      |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **SessionStart**      | Session initialization or resumption.           | Parses `project.config.yml`, initializes runtime state tracking under `.claude/hooks/.state/`, and validates tools. |
| **UserPromptSubmit**  | User submits input.                             | Evaluates incoming input for policy compliance and blocks bypass attempts.                                          |
| **PreToolUse**        | Prior to tool execution.                        | Intercepts commands against `deny_cmd_patterns` and enforces `implementor-git-guard.sh`.                            |
| **PermissionRequest** | Tool invocation requires elevated permission.   | Enforces `ask_cmd_patterns` and `ask_write_paths` authorization checks.                                             |
| **PostToolUse**       | Immediately following file edits (Write, Edit). | Triggers phase 1 verification (`verify-loop.sh`) on changed files matching `include_glob`.                          |
| **Stop**              | Completion of an agent execution turn.          | Triggers phase 2 verification, running broad project compilation and typechecking.                                  |

### Exit Code Enforcement Rules

- **Exit Code 0 (Proceed):** Operation permitted; execution continues.
- **Exit Code 1 (Advisory Warning):** Non-blocking notification logged to context window; execution continues. Never use for security or verification blocking.
- **Exit Code 2 (Hard Block):** Halts tool execution. Injects stdout/stderr directly into the agent context window to force remediation.

### Two-Phase Verification Strategy

To eliminate latency during editing sessions, verification is split into two distinct phases:

1. **Phase 1: Lightweight PostToolUse Interception** (`hooks/verify-loop.sh`)
   - Scoped strictly to files matching `include_glob` (skipping `skip_globs`).
   - Runs single-file linting (`lint_cmd`) and co-located unit tests (`test_pattern`) using substituted file paths.
   - Tracks attempt counts per `session:file` under `.claude/hooks/.state/`. Within budget, failures return Exit Code 2 with diagnostic feedback. After `loop_budget` consecutive failures, blocking ceases and the issue is flagged for human review.

2. **Phase 2: Deferred Validation at Stop / Phase Boundaries**
   - Broad project compilation, static analysis (`extra_validate_cmd`), and multi-module checks execute only during the Stop event or when handing control from Implementor to Verifier.

### Fail-Safe Contract

If `project.config.yml` is missing or unparseable, all hook scripts must exit with code 2, outputting a clear error message. Hooks must never silently no-op.

---

## 5. Permission Model — `settings.base.json`

The framework ships a standardized permission shape that is hydrated with paths from `project.config.yml` during repository scaffolding:

- **deny** (Hard Block, No Override): Key files (`*.keystore`, `*.p12`, `.env*`), prohibited system commands, live database CLIs, and destructive operations.
- **ask** (Explicit Human Approval Required): Remote git operations (`git push`), release assemble/publish tasks, and edits to critical manifest files (`AndroidManifest.xml`, `Info.plist`).
- **allow** (Automated Execution): Local file reads, edits within designated source directories (`allow_write_paths`), safe pattern matches, and local git commands (`git add`, `git checkout -b`).

---

## 6. Autonomy Tiers A–E

Tasks are categorized into five fixed autonomy tiers. While the ladder structure is invariant, trigger conditions are defined per team in `project.config.yml`:

| Tier       | Definition                                                                 | Handling & Governance Requirements                                                                             |
| ---------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Tier A** | Standard minor change or test addition.                                    | Autonomous execution; proceeds through standard CI/CD verification.                                            |
| **Tier B** | Feature implementation within existing architecture.                       | Autonomous execution; requires standard peer pull-request review.                                              |
| **Tier C** | Cross-cutting or sensitive domain change.                                  | Requires named domain reviewer (`tiers.C_needs_reviewer`); Verifier executes `extra_validate_cmd`.             |
| **Tier D** | Architecturally significant change matching `tiers.D_triggers`.            | **HARD STOP.** AI agent halts execution. Requires pre-approved Architecture Decision Record under `/ADR/*.md`. |
| **Tier E** | Production deployment or secrets modification matching `tiers.E_triggers`. | **ABSOLUTE REFUSAL.** AI agents are strictly denied access. Referred to human team leads.                      |

---

## 7. Rule Taxonomy

Every rule defined in `hard_rules[]` must be categorized across two structural axes:

### Audit Classification

- `audit: static`: Enforceable mechanically via hook scripts, static analysis CLI, or file glob matchers (e.g., prohibiting production URLs).
- `audit: verifier`: Requires contextual reasoning (e.g., ensuring log statements omit PII). Audited by the Verifier sub-agent during post-implementation review.

### Review Gate Severity

- `review_gate: blocking`: Failures halt the pipeline, preventing task commits and PR creation.
- `review_gate: advisory`: Failures raise warnings in `REVIEW.md` for human review without halting automated task progress.

---

## 8. Ticket-Source Adapter Boundary

Ticket intake follows an abstract workflow: **Resolve ticket → Read requirements → Author specification in `docs/specs/<feature>.md`**. Downstream execution remains completely source-agnostic.

- **MCP Adapter Mode:** Interacts with ticketing platforms (e.g., Jira, Linear, Zoho) via configured connectors. Connectors are strictly restricted to read-only tool sets (Get, List, Read). Write-back capabilities are denied to preserve least-privilege security.
- **Manual Fallback Mode:** Engineers paste raw ticket requirements into the terminal prompt. The Coordinator formats the text into `docs/specs/<feature>.md` and resumes the standard pipeline.

---

## 9. Repository Layout and Conformance Criteria

### Consuming Repository Target Structure

```
<consuming-repo>/
├── .claude/
│   ├── agents/              # Generic sub-agent definitions (Vendored)
│   │   ├── coordinator.md
│   │   ├── implementor.md
│   │   └── verifier.md
│   ├── hooks/                # Config-driven shell scripts (Vendored)
│   │   ├── verify-loop.sh
│   │   ├── implementor-git-guard.sh
│   │
│   └── .state/                # Ephemeral execution state (Git-ignored)
├── project.config.yml         # Load-bearing configuration file
├── CLAUDE.md                  # Hydrated project instructions
├── REVIEW.md                  # Generated review checklist
├── ADR/                       # Architecture Decision Records
│   └── 0000-template.md
└── docs/
    ├── specs/                 # Task specs generated by Coordinator
    └── reviews/                # Verifier execution verdicts
```

### Automation Scaffolder (`scripts/scaffold.mjs`)

Teams onboard via an automated initialization command: `node scripts/scaffold.mjs --template <stack>`. The scaffolder:

1. Vendors `.claude/agents/` and `.claude/hooks/` into the target repository.
2. Generates a stack-tailored `project.config.yml`.
3. Hydrates `CLAUDE.md` and `REVIEW.md` using settings from `project.config.yml`.
4. Executes `scripts/validate-config.mjs` to confirm schema integrity.

### Platform Conformance Checklist (`docs/CONFORMANCE.md`)

A repository is compliant with enterprise governance when it satisfies all eight criteria:

1. **Config Binding:** A brand-new team can adopt the framework by editing only `project.config.yml` (plus filling rulebooks) and running the scaffolder.
2. **Domain Isolation:** Core framework files contain zero domain-specific references (e.g., Gradle or pnpm commands exist only in team configs).
3. **Zero Command Duplication:** Hooks read commands directly from `project.config.yml`; `CLAUDE.md` contains zero duplicate command strings.
4. **Fail-Safe Execution:** Missing or malformed configuration files cause hooks to exit with code 2 (hard block), never silently no-oping.
5. **Separation of Duties:** Implementor cannot execute state-changing git commands; Verifier cannot edit files.
6. **Schema Enforcement:** `validate-config.mjs` successfully rejects unclassified hard rules, missing tier triggers, write-capable ticket connectors, or non-integer loop budgets.
7. **Two-Phase Verification:** Heavy checks are deferred to phase boundaries, keeping active file-editing loops fast and responsive.
8. **End-to-End Verification:** Mobile and backend worked examples execute completely without requiring modifications to the core framework repository.

---

## Works Cited

1. Workflows in Agentic AI — Claude code workflows | by DhanushKumar - Medium, https://medium.com/@danushidk507/workflows-in-agentic-ai-claude-code-workflows-8cac80792dd8
2. Agent Hooks Are Claude Code's Most Powerful Feature (and Almost Nobody Uses Them), https://engineeratheart.medium.com/agent-hooks-are-claude-codes-most-powerful-feature-and-almost-nobody-uses-them-d88d64f6172d
3. Fast AI Feedback Loops with Honeycomb and OpenTelemetry, https://www.honeycomb.io/blog/fast-ai-feedback-loops-honeycomb-opentelemetry
4. A Deep Architecture Review of Claude Code: 5 Critical Gaps That Reveal the Future of Agentic AI | by Yi Zhou, https://www.agenticengineeringinstitute.com/blog/a-deep-architecture-review-of-claude-code-5-critical-gaps-that-reveal-the-future-of-agentic-ai
5. Claude Code Hooks: From Linting to Hardened AI Workflows | Thomas Wiegold Blog, https://thomas-wiegold.com/blog/claude-code-hooks/
6. Hooks reference - Claude Code Docs, https://code.claude.com/docs/en/hooks
