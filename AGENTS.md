# Ydun AI Workflow — Templates, Prompts, and Patterns for AI-Assisted Development

**Version**: 3.0.0
**Last Updated**: 2026-03-09

## Repository Information

- **GitHub**: https://github.com/ydun-code-library/Ydun_ai_workflow
- **Documentation**: https://docs.ydun.io
- **License**: MIT

## What This Repo Contains

A collection of production-tested templates, prompt frameworks, and development tools for AI-assisted development. Clone it, copy what you need, fill the placeholders.

**This is a distribution repo** — pure files, no framework, no build step. The full documentation site with guides, research, and methodology deep-dives is at [docs.ydun.io](https://docs.ydun.io).

## Repository Structure

```
Ydun_ai_workflow/
├── templates/
│   ├── core/                    # Project setup templates
│   │   ├── AGENTS.md.template   # AI assistant guidelines (agents.md standard)
│   │   ├── CLAUDE.md.template   # Claude quick reference
│   │   ├── JIMMYS-WORKFLOW.md   # Validation system v2.1
│   │   ├── STATUS.md.template   # Project status tracking
│   │   └── NEXT-SESSION-START-HERE.md.template
│   ├── init/                    # Project initialisation guides
│   │   ├── init-project.md      # 14-step setup checklist
│   │   └── AGENTS-TEMPLATE-GUIDE.md
│   ├── docs/                    # Documentation standards
│   │   ├── DOCUMENTATION-STANDARDS.md
│   │   ├── AI-DRIVEN-SEO-BEST-PRACTICES.md
│   │   └── doc-components/      # Reusable doc templates
│   └── tools/                   # Shell scripts
│       ├── audit-project.sh     # Compliance audit
│       ├── check-version.sh     # Template version check
│       └── sync-templates.sh    # Template sync utility
├── prompts/
│   ├── audit/                   # Multi-lens audit system
│   │   ├── codebase-audit-prompt.md
│   │   ├── claude-code-audit-prompt.md
│   │   ├── json-sidecar-pattern.md
│   │   └── templates/           # 5 execution templates
│   └── methodology/             # Prompt engineering
│       ├── cap-workflow-methodology.md
│       ├── prompt-testing-implementation-guide.md
│       ├── audit-map-execution-patterns.md
│       └── god-prompt-methodology.md
├── AGENTS.md                    # This file
├── CLAUDE.md                    # Quick reference
├── JIMMYS-WORKFLOW.md           # Workflow v2.1 (full reference)
├── README.md                    # Project overview
├── VERSION                      # Current version
├── llms.txt                     # AI discoverability
└── LICENSE                      # MIT
```

## Quick Start

```bash
git clone https://github.com/ydun-code-library/Ydun_ai_workflow.git
cd Ydun_ai_workflow

# Copy core templates to your project
cp templates/core/AGENTS.md.template /path/to/your-project/AGENTS.md
cp templates/core/CLAUDE.md.template /path/to/your-project/CLAUDE.md
cp templates/core/JIMMYS-WORKFLOW.md /path/to/your-project/

# Fill the [PROJECT_SPECIFIC] sections with your project details
```

For the full 14-step project initialisation, see `templates/init/init-project.md`.

## Core Development Principles

### 1. KISS (Keep It Simple, Stupid)
- Avoid over-complication and over-engineering
- Choose simple solutions over complex ones
- Question every abstraction layer

### 2. TDD (Test-Driven Development)
- Write tests first
- Run tests to ensure they fail (Red phase)
- Write minimal code to pass tests (Green phase)
- Refactor while keeping tests green

### 3. Separation of Concerns (SOC)
- Each module/component has a single, well-defined responsibility
- Clear boundaries between different parts of the system
- Services should be loosely coupled

### 4. DRY (Don't Repeat Yourself)
- Eliminate code duplication
- Extract common functionality into reusable components

### 5. Documentation Standards
- Always include the actual date when writing documentation
- Use objective, factual language only
- Avoid marketing terms ("production-ready", "world-class", "cutting-edge")
- State current development status clearly
- Document what IS, not what WILL BE

### 5.5. AI-Optimized Documentation
Documentation is structured data for both humans AND AI consumption.

**The 7 Principles:**
1. Structured Data Over Prose — use tables, JSON, YAML instead of paragraphs
2. Explicit Context — never assume prior knowledge
3. Cause-Effect Relationships — clear "if X then Y" statements
4. Machine-Readable Formats — consistent, parseable metadata
5. Searchable Content — keywords, anchors, consistent terminology
6. Version-Stamped — date all documentation updates
7. Cross-Referenced — explicit links between related docs

### 6. Jimmy's Workflow v2.1 (MANDATORY)
Four-phase checkpoint system preventing AI hallucination:

```
PRE-FLIGHT → IMPLEMENT → VALIDATE → CHECKPOINT
```

- **PRE-FLIGHT**: Verify context — do I have all files, requirements, dependencies?
- **IMPLEMENT**: Write code, build features, make changes
- **VALIDATE**: Run explicit validation with documented reasoning and confidence level
- **CHECKPOINT**: Mark completion with confidence level and validity conditions

**Confidence Levels:**
- **HIGH**: Proceed automatically
- **MEDIUM**: Human spot-check recommended
- **LOW**: Human validation required

**Reference**: See `JIMMYS-WORKFLOW.md` for the complete system (877 lines with examples, decision trees, and templates).

### 7. YAGNI (You Ain't Gonna Need It)
- Don't implement features until they're actually needed
- Build for current requirements, not hypothetical future ones
- Every line of code is a liability — only write what's necessary

### 8. Fix Now, Not Later
- Fix vulnerabilities immediately when discovered
- Fix warnings immediately — don't suppress or accumulate
- Fix failing tests immediately — understand root cause, don't skip
- Don't use suppressions without documented justification

### 9. Measure Twice, Cut Once
- Always verify your understanding before executing
- Double-check file paths, command syntax, and target locations
- When in doubt, investigate first — don't guess

### 10. No Shortcuts (Do It Right)
- Complete the job properly — no half-measures
- Don't skip steps to save time
- Quality over speed — cutting corners creates debt

### 11. Rules Persist (Context Compression Immunity)
- ALL rules remain in effect after auto-compact/context summarisation
- Core principles are NEVER optional, regardless of context length
- If you can't remember a rule, re-read AGENTS.md

## GitHub Workflow

Use `gh` CLI for all GitHub operations:

```bash
# Pull Requests
gh pr create --title "Feature" --body "Description"
gh pr list
gh pr checks

# Issues
gh issue create --title "Bug" --body "Description"
gh issue list

# CI/CD
gh run list
gh run watch
```

## Template Version Management

This repo uses a VERSION file at root. Templates include version headers:

```html
<!-- TEMPLATE_VERSION: 1.7.0 -->
```

**Check version:**
```bash
templates/tools/check-version.sh
```

**Sync to latest:**
```bash
templates/tools/sync-templates.sh --dry-run   # Preview changes
templates/tools/sync-templates.sh             # Apply with confirmation
```

**Audit compliance:**
```bash
templates/tools/audit-project.sh              # Full audit
templates/tools/audit-project.sh --quick      # Quick check
```

## Contributing

1. Read this AGENTS.md
2. Follow the 11 principles
3. Use Jimmy's Workflow for all implementation tasks
4. Write tests first (TDD)
5. Document decisions with dates

## Further Reading

- **Full documentation**: [docs.ydun.io](https://docs.ydun.io)
- **Jimmy's Workflow deep dive**: [docs.ydun.io/workflow/jimmys-workflow](https://docs.ydun.io/workflow/jimmys-workflow/)
- **Multi-agent coordination**: [docs.ydun.io/guides/multi-agent-setup](https://docs.ydun.io/guides/multi-agent-setup/)
- **agents.md standard**: [agents.md](https://agents.md/)

---

**This document follows the [agents.md](https://agents.md/) standard for AI coding assistants.**
