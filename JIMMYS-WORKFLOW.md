---
document_type: workflow
name: Jimmy's Workflow - Red/Green Checkpoint System
version: "2.1"
updated: "2026-01"
target_model: claude-opus-4-5
primary_use: executing_development_with_validation
secondary_use: validating_ai_generated_code

changelog:
  v2.1:
    - "Added PRE-FLIGHT check to RED phase"
    - "Prevents implementation without sufficient context"
    - "Updated version references to part2 v2.2"
  v2.0:
    - "Added confidence levels (HIGH/MEDIUM/LOW)"
    - "Added reasoning documentation requirement"
    - "Added alternatives_rejected and weaknesses_acknowledged"
    - "Added COI disclosure for AI-validating-AI"
    - "Added validity triggers for checkpoint staleness"

load_when:
  - executing development tasks with AI
  - implementing features with checkpoints
  - validating AI-generated code
  - need validation structure with confidence levels

skip_when:
  - designing audit prompts (use part1)
  - building component libraries (use part2)

requires: null
enhances:
  - god-prompt-methodology-part1-v2.1.md
  - god-prompt-methodology-part2-v2.2.md

key_sections:
  - "PRE-FLIGHT Check (NEW in v2.1)"
  - "GREEN VALIDATE Phase (Enhanced)"
  - "Validation Reasoning"
  - "Confidence Levels for Validation"
  - "COI Disclosure Component"
  - "Decision Tree: When to Proceed"

exports:
  validation_structure: "Section: GREEN VALIDATE Phase (Enhanced)"
  confidence_actions: "Section: Decision Tree: When to Proceed"
  coi_template: "Section: COI Disclosure Component"
  preflight_check: "Section: PRE-FLIGHT Check"

autonomous_rules:
  preflight_fails: stop_gather_context_first
  confidence_high: proceed_automatically
  confidence_medium: pause_for_human_spotcheck
  confidence_low: stop_require_human_validation
  security_code: pause_regardless_of_confidence
  ai_validating_ai: flag_coi_recommend_human_review

invocation: "Let's use Jimmy's Workflow to execute this plan"
---

<!--
TEMPLATE_VERSION: 2.1
TEMPLATE_SOURCE: templates/core/JIMMYS-WORKFLOW.md
DISTRIBUTION: Copy to project root OR reference from platform root
LAST_SYNC: See version check below
-->

# Jimmy's Workflow v2.1: Red/Green Checkpoint System with Assessment Rigor

## What It Is

Jimmy's Workflow is a **validation-gate system** designed to combat AI hallucination and ensure robust implementation through mandatory checkpoints. Version 2.1 adds a **PRE-FLIGHT check** to prevent the common failure mode of starting implementation without sufficient context.

**Version**: 2.1
**Updated**: January 2026

---

## What's New in v2.1

| Addition | Purpose |
|----------|---------|
| **PRE-FLIGHT check** | Explicit context verification before implementation begins |
| **"Do I have enough?"** | Prevents starting without dependencies, files, or requirements |
| **Blockers list** | Documents what's missing before proceeding |

### Inherited from v2.0

| Feature | Purpose |
|---------|---------|
| **Confidence levels** | Not all validations are equally certain |
| **Reasoning documentation** | WHY does passing tests prove correctness? |
| **Alternatives checked** | What else was verified? What was ruled out? |
| **Weaknesses acknowledged** | What might this validation miss? |
| **COI disclosure** | AI validating AI-generated code has blind spots |
| **Validity triggers** | When does a checkpoint become stale? |
| **Defense in depth** | Layered validation when confidence is uncertain |

---

## The Core Problem It Solves

### AI Hallucination in Development
- AI says "done" ≠ Actually done
- Tests pass ≠ Implementation is correct
- AI writes tests that validate AI's assumptions (circular validation)
- "Works in test" ≠ "Works in production"
- **NEW**: AI starts implementing before realizing it's missing dependencies

### The v2.1 Addition: Pre-flight Context Check
- **Explicit gate** before any code is written
- **Lists what's needed** vs. what's available
- **Blocks implementation** until context is sufficient
- **Prevents wasted effort** on implementations that will fail

---

## The Four-Phase Pattern (Enhanced in v2.1)

Every implementation follows this mandatory sequence:

```
🔴 PRE-FLIGHT → 🔴 IMPLEMENT → 🟢 VALIDATE → 🔵 CHECKPOINT
```

**Note**: PRE-FLIGHT is part of the RED phase but executes BEFORE any implementation begins.

---

## 🔴 PRE-FLIGHT Check (NEW in v2.1)

**Purpose**: Verify sufficient context exists before starting implementation

**Required Questions**:

```markdown
🔴 PRE-FLIGHT:

## Context Inventory

### Requirements Clarity
- [ ] Is the task clearly defined?
- [ ] Are success criteria explicit and measurable?
- [ ] Are edge cases identified?

### Files Needed
| File | Status | Notes |
|------|--------|-------|
| [file1.ts] | ✅ Have | In context |
| [file2.ts] | ❌ Need | Must request |
| [config.json] | ⚠️ Partial | Have schema, need values |

### Dependencies
- [ ] Are all imported modules available?
- [ ] Are external APIs documented?
- [ ] Are environment variables defined?

### Domain Knowledge
- [ ] Do I understand the existing patterns in this codebase?
- [ ] Do I know the coding conventions used?
- [ ] Are there similar implementations I should reference?

## Pre-flight Decision

**Status**: 🟢 CLEAR | 🟡 GAPS | 🔴 BLOCKED

### If GAPS or BLOCKED:

**Missing Context**:
1. [What's missing]
2. [What's missing]

**Action Required**:
- [ ] Request file: [filename]
- [ ] Clarify requirement: [question]
- [ ] Need documentation for: [topic]

**Do NOT proceed to IMPLEMENT until status is 🟢 CLEAR**
```

### Pre-flight Examples

**Example 1: Clear to proceed**
```markdown
🔴 PRE-FLIGHT:

## Context Inventory

### Requirements Clarity
- [x] Task: Add rate limiting to API endpoints
- [x] Success: 100 req/min per IP, 429 response when exceeded
- [x] Edge cases: Whitelist for internal IPs

### Files Needed
| File | Status | Notes |
|------|--------|-------|
| src/middleware/auth.ts | ✅ Have | Will add rate limit here |
| src/config/limits.ts | ✅ Have | Config structure clear |
| package.json | ✅ Have | Can add dependencies |

### Dependencies
- [x] express-rate-limit available on npm
- [x] Redis connection exists for distributed limiting

### Domain Knowledge
- [x] Middleware pattern used in this codebase understood
- [x] Config injection pattern clear

## Pre-flight Decision

**Status**: 🟢 CLEAR

Proceeding to IMPLEMENT.
```

**Example 2: Blocked - missing context**
```markdown
🔴 PRE-FLIGHT:

## Context Inventory

### Requirements Clarity
- [x] Task: Integrate with payment provider
- [ ] Success: ??? (which provider? Stripe? PayPal?)
- [ ] Edge cases: ??? (refunds? disputes? webhooks?)

### Files Needed
| File | Status | Notes |
|------|--------|-------|
| src/services/payment.ts | ❌ Need | Doesn't exist, need to create |
| src/types/order.ts | ⚠️ Partial | Have file, need Order interface details |
| .env.example | ❌ Need | Don't know required env vars |

### Dependencies
- [ ] Which payment SDK?
- [ ] API credentials available?

### Domain Knowledge
- [ ] Existing error handling patterns?
- [ ] How are async operations handled in this codebase?

## Pre-flight Decision

**Status**: 🔴 BLOCKED

**Missing Context**:
1. Payment provider not specified
2. Order interface not visible
3. Environment variable requirements unknown

**Action Required**:
- [ ] Clarify: Which payment provider (Stripe/PayPal/other)?
- [ ] Request file: src/types/order.ts
- [ ] Request file: .env.example or env var documentation
- [ ] Clarify: Are webhooks required for this integration?

**Do NOT proceed to IMPLEMENT until these are resolved.**
```

### Pre-flight Decision Tree

```
Do I have clear requirements?
├── NO → 🔴 BLOCKED - Ask clarifying questions
└── YES → Check files needed
    ├── Missing critical files → 🔴 BLOCKED - Request files
    └── Have files → Check dependencies
        ├── Unknown dependencies → 🟡 GAPS - Document and request
        └── Dependencies clear → Check domain knowledge
            ├── Unfamiliar patterns → 🟡 GAPS - Request examples
            └── Patterns understood → 🟢 CLEAR - Proceed to IMPLEMENT
```

---

## 🔴 RED: IMPLEMENT Phase

**Purpose**: Write code, build features, make changes

**Prerequisite**: PRE-FLIGHT status must be 🟢 CLEAR

**Required Documentation**:
```markdown
🔴 IMPLEMENT:

Pre-flight: 🟢 CLEAR (verified above)

Task: [Clear description of what's being built]
Files: [List of files to modify]
Expected Outcome: [What success looks like]

Complexity: 🟢 Simple | 🟡 Moderate | 🔴 Complex
Time Estimate: [X minutes/hours]

Success Criteria:
- [ ] Criterion 1 (measurable)
- [ ] Criterion 2 (measurable)
- [ ] Criterion 3 (measurable)

AI Assistance Disclosure: [Yes/No - was AI used to generate this code?]
```

**Example**:
```markdown
🔴 IMPLEMENT:

Pre-flight: 🟢 CLEAR

Task: Add JWT-based authentication to replace session cookies
Files: src/auth/login.ts, src/middleware/auth.ts, src/types/auth.ts
Expected Outcome: Users authenticate via JWT tokens with 1-hour expiry

Complexity: 🟡 Moderate
Time Estimate: 30 minutes

Success Criteria:
- [ ] Login endpoint returns valid JWT
- [ ] Protected routes reject invalid/expired tokens
- [ ] Token refresh works before expiry
- [ ] Logout invalidates token

AI Assistance Disclosure: Yes - implementation generated with Claude Code
```

---

## 🟢 GREEN: VALIDATE Phase (Enhanced)

**Purpose**: Prove the implementation actually works with documented reasoning

### Required Structure

Every validation MUST include:

```markdown
🟢 VALIDATE:

## Automated Checks
| Check | Command | Result | Proves |
|-------|---------|--------|--------|
| Tests | `npm test` | ✅ 24/24 pass | Unit logic correct |
| Build | `npm run build` | ✅ Exit 0 | No compile errors |
| Types | `npm run typecheck` | ✅ 0 errors | Type safety maintained |
| Lint | `npm run lint` | ✅ 0 warnings | Code style compliant |

## Manual Verification
| Scenario | Action | Expected | Actual | Status |
|----------|--------|----------|--------|--------|
| Valid login | POST /login with valid creds | 200 + JWT | 200 + JWT | ✅ |
| Invalid login | POST /login with bad password | 401 | 401 | ✅ |
| Protected route | GET /api/user with valid token | 200 + user data | 200 + user data | ✅ |
| Expired token | GET /api/user with expired token | 401 | 401 | ✅ |

## Validation Reasoning

**Confidence**: HIGH | MEDIUM | LOW

**Why This Validation Proves Correctness**:
1. [First reason - connects test to requirement]
2. [Second reason - explains coverage]
3. [Third reason - addresses edge cases]

**Alternatives Checked**:
- [x] Checked: [Alternative approach or scenario]
- [x] Ruled out: [What was considered but rejected, and why]

**Weaknesses Acknowledged**:
- [ ] This validation does NOT verify: [Gap 1]
- [ ] This validation does NOT verify: [Gap 2]
- [ ] Assumption made: [What we're assuming is true]

**Defense in Depth** (if confidence < HIGH):
- Primary validation: [Main approach]
- Secondary validation: [Backup approach]
- Tertiary validation: [Additional check]
```

### Confidence Levels for Validation

| Level | Meaning | Human Action |
|-------|---------|--------------|
| **HIGH** | Automated tests + manual verification + edge cases covered | Proceed, spot-check if time |
| **MEDIUM** | Tests pass but some scenarios untested or assumptions made | Human should verify key paths |
| **LOW** | Minimal validation, significant gaps, needs more testing | Human MUST validate before proceed |

### Example with Full Reasoning

```markdown
🟢 VALIDATE:

## Automated Checks
| Check | Command | Result | Proves |
|-------|---------|--------|--------|
| Tests | `npm test` | ✅ 24/24 pass | Unit logic correct |
| Build | `npm run build` | ✅ Exit 0 | No compile errors |
| Types | `npm run typecheck` | ✅ 0 errors | Type safety |

## Manual Verification
| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| Valid login | 200 + JWT | 200 + JWT | ✅ |
| Invalid password | 401 | 401 | ✅ |
| Expired token | 401 | 401 | ✅ |
| Malformed token | 401 | 401 | ✅ |

## Validation Reasoning

**Confidence**: MEDIUM

**Why This Validation Proves Correctness**:
1. Unit tests cover token generation, validation, and expiry logic
2. Manual tests verify actual HTTP flow matches expected behavior
3. Edge cases (expired, malformed) explicitly tested

**Alternatives Checked**:
- [x] Checked: Token works across server restart (stateless verification)
- [x] Checked: Multiple concurrent logins produce unique tokens
- [x] Ruled out: Session-based approach (doesn't scale, was original design)

**Weaknesses Acknowledged**:
- [ ] NOT verified: Behavior under high load (no load testing)
- [ ] NOT verified: Token security against timing attacks
- [ ] Assumption: jsonwebtoken library is secure (not audited)
- [ ] Gap: Refresh token rotation not tested with concurrent requests

**Defense in Depth** (confidence is MEDIUM):
- Primary: Automated tests + manual HTTP verification
- Secondary: Code review of token generation logic
- Tertiary: Check jwt.io debugger shows correct claims

## COI Disclosure (AI-Generated Code)

This implementation was generated with AI assistance (Claude Code).
This validation was performed by AI (Claude).

**Potential blind spots**:
- AI may validate assumptions it made during generation
- Test cases may miss scenarios AI didn't consider
- "Looks correct" ≠ "Is correct"

**Mitigation**: Human review recommended for auth-critical code.
```

---

## 🔵 CHECKPOINT: GATE Phase (Enhanced)

**Purpose**: Lock in validated progress with full audit trail

### Required Structure

```markdown
🔵 CHECKPOINT: [Feature Name]

## Status
Status: 🔵 COMPLETE | 🟡 IN_PROGRESS | 🔴 BLOCKED
Confidence: HIGH | MEDIUM | LOW
Validated: [ISO 8601 timestamp]

## Metrics
| Metric | Value |
|--------|-------|
| Complexity | 🟢 Simple / 🟡 Moderate / 🔴 Complex |
| Estimated | X minutes |
| Actual | Y minutes |
| Variance | +/- Z minutes |
| Tests | X/Y passing |
| Coverage | X% (if tracked) |

## Validation Summary
**What was proven**:
- [Key validation 1]
- [Key validation 2]

**What was NOT proven** (acknowledged gaps):
- [Gap 1]
- [Gap 2]

## Rollback Procedure
```bash
[Exact commands to undo this change]
```

## Validity Conditions

**This checkpoint remains valid UNTIL**:
- [ ] Dependencies change (list which ones)
- [ ] Related code modified (list files)
- [ ] X days elapsed (specify timeframe)
- [ ] External API changes (if applicable)

**Re-validation required if**:
- [ ] [Specific trigger 1]
- [ ] [Specific trigger 2]

## Dependencies
- Depends on: [Previous checkpoints]
- Blocks: [Subsequent checkpoints]

## Lessons Learned
- [Insight 1]
- [Insight 2]
```

### Example with Full Structure

```markdown
🔵 CHECKPOINT: JWT Authentication Complete

## Status
Status: 🔵 COMPLETE
Confidence: MEDIUM
Validated: 2026-01-17T14:30:00Z

## Metrics
| Metric | Value |
|--------|-------|
| Complexity | 🟡 Moderate |
| Estimated | 30 minutes |
| Actual | 45 minutes |
| Variance | +15 minutes |
| Tests | 24/24 passing |
| Coverage | 87% |

## Validation Summary
**What was proven**:
- Token generation produces valid JWTs
- Token validation correctly accepts/rejects
- Expiry logic works as specified
- HTTP integration functions correctly

**What was NOT proven** (acknowledged gaps):
- Performance under load
- Security against sophisticated attacks
- Behavior with clock skew between servers
- Token rotation edge cases

## Rollback Procedure
```bash
git revert abc123
npm install
npm test  # Verify rollback successful
```

## Validity Conditions

**This checkpoint remains valid UNTIL**:
- [ ] jsonwebtoken package updated
- [ ] Auth middleware modified
- [ ] Token expiry requirements change
- [ ] 90 days elapsed (security review cycle)

**Re-validation required if**:
- [ ] Security vulnerability reported in JWT library
- [ ] Authentication failures reported in production
- [ ] New auth-dependent features added

## Dependencies
- Depends on: Database schema checkpoint
- Blocks: User profile API, Admin dashboard

## Lessons Learned
- Token expiry edge cases took longer than expected
- Should have written tests first (TDD would have caught issues earlier)
- jsonwebtoken docs are incomplete; had to read source
- Pre-flight check would have caught missing env var documentation earlier
```

---

## COI Disclosure Component

When AI generates code AND AI validates it, include this disclosure:

```markdown
## COI: AI-Generated Code Validation

### Disclosure
- **Code generated by**: [AI assistant name/model]
- **Validation performed by**: [AI assistant name/model]
- **Same model family**: Yes/No

### Identified Risks
| Risk | Description |
|------|-------------|
| Circular validation | AI may validate its own assumptions |
| Shared blind spots | Same model may miss same edge cases |
| Confidence inflation | AI may report higher confidence than warranted |
| Pattern familiarity | May not flag patterns it considers "normal" |

### Mitigations Applied
- [ ] Explicit reasoning documented for all validations
- [ ] Weaknesses acknowledged
- [ ] Confidence level reflects actual certainty
- [ ] Human review flagged where confidence < HIGH

### Recommended Additional Validation
- [ ] Human review of critical paths
- [ ] Static analysis tools (independent verification)
- [ ] Second-opinion from different AI model (if high stakes)
- [ ] Security review for auth/crypto code
```

---

## Validation Template (v2.1)

Use this checklist for every implementation:

```markdown
## 🔴 PRE-FLIGHT
- [ ] Requirements clear and measurable
- [ ] All needed files available
- [ ] Dependencies identified
- [ ] Domain patterns understood
- [ ] Status: 🟢 CLEAR

## 🔴 IMPLEMENT
- [ ] Pre-flight verified
- [ ] Task documented
- [ ] Success criteria defined
- [ ] AI assistance disclosed

## 🟢 VALIDATE

### Automated Checks
- [ ] `npm test` - all pass
- [ ] `npm run build` - success
- [ ] `npm run typecheck` - 0 errors
- [ ] `npm run lint` - no warnings

### Code Quality
- [ ] No console.log in production code
- [ ] No @ts-expect-error directives
- [ ] No hardcoded credentials
- [ ] Functions under 20 lines
- [ ] Files under 200 lines

### Manual Verification
- [ ] Test: [Primary user scenario] → [Expected result]
- [ ] Test: [Error scenario] → [Expected error handling]
- [ ] Test: [Edge case] → [Expected behavior]

### Security (if applicable)
- [ ] No exposed API keys
- [ ] Input validation present
- [ ] Authentication enforced
- [ ] Authorization checked

### Validation Reasoning (REQUIRED)

**Confidence**: HIGH / MEDIUM / LOW

**Why this proves correctness**:
1. [Reason 1]
2. [Reason 2]

**Alternatives checked**:
- [x] [What else was verified]

**Weaknesses acknowledged**:
- [ ] NOT verified: [Gap]
- [ ] Assumption: [What we're assuming]

### COI Disclosure (if AI-generated code)
- [ ] Disclosed AI involvement
- [ ] Documented potential blind spots
- [ ] Flagged for human review if confidence < HIGH

## 🔵 CHECKPOINT
- [ ] Status documented
- [ ] Confidence level assigned
- [ ] Rollback procedure defined
- [ ] Validity conditions specified
```

---

## Decision Tree: When to Proceed

```
Pre-flight Complete?
├── NO → 🔴 BLOCKED - Complete pre-flight first
└── YES → Pre-flight Status?
    ├── 🔴 BLOCKED → Gather missing context
    ├── 🟡 GAPS → Address gaps, then re-check
    └── 🟢 CLEAR → Proceed to IMPLEMENT
        └── Implementation Complete?
            ├── NO → Continue implementing
            └── YES → Validation Complete?
                ├── NO → 🔴 BLOCKED - Fix issues first
                └── YES → Check Confidence Level
                    ├── HIGH → 🔵 PROCEED automatically
                    ├── MEDIUM → 🟡 PAUSE for human spot-check
                    │   └── Human approves? → 🔵 PROCEED
                    │   └── Human rejects? → 🔴 BLOCKED
                    └── LOW → 🔴 BLOCKED until human validates
                        └── Human validates → 🔵 PROCEED
                        └── Human finds issues → Fix and re-validate
```

---

## Autonomous Execution Rules (v2.1)

For AI assistants working autonomously:

| Condition | Action |
|-----------|--------|
| Pre-flight not complete | 🛑 STOP, complete pre-flight first |
| Pre-flight status 🔴 BLOCKED | 🛑 STOP, report missing context, await response |
| Pre-flight status 🟡 GAPS | ⏸️ PAUSE, document gaps, request clarification |
| Pre-flight status 🟢 CLEAR | ✅ Proceed to IMPLEMENT |
| All validations pass, confidence HIGH | ✅ Proceed automatically |
| All validations pass, confidence MEDIUM | ⏸️ PAUSE, report to human, await approval |
| All validations pass, confidence LOW | 🛑 STOP, require human validation |
| Any validation fails | 🛑 STOP, report failure, await instruction |
| Security-related code | ⏸️ PAUSE regardless of confidence |
| AI validating AI-generated code | Flag COI, recommend human review |

---

## Integration with Assessment MAPs

Jimmy's Workflow can trigger assessment MAPs at checkpoints:

```markdown
🔵 CHECKPOINT: Feature Complete

## Automated Assessment (Optional)
Trigger: Security Audit MAP
Scope: Changed files only
Findings:
- SEC-001: [Finding] (Confidence: HIGH) → Must fix
- SEC-002: [Finding] (Confidence: LOW) → Human review

Gate Decision:
- HIGH confidence findings must be resolved
- MEDIUM/LOW findings documented for human review
```

---

## Migration from v2.0

### What Changes
| v2.0 | v2.1 |
|------|------|
| Jump straight to IMPLEMENT | PRE-FLIGHT check required first |
| Discover missing context mid-implementation | Identify gaps before starting |
| Wasted effort on blocked implementations | Early detection of blockers |

### What Stays the Same
- 🔴→🟢→🔵 phase pattern (PRE-FLIGHT is part of RED)
- Confidence levels (HIGH/MEDIUM/LOW)
- Reasoning documentation
- COI disclosure
- Rollback requirement
- Validity conditions

### Upgrade Path
1. Add PRE-FLIGHT section to existing templates
2. Audit current IN_PROGRESS items for context gaps
3. Update autonomous rules to check pre-flight first
4. Train team on "ask first, implement second" pattern

---

## Quick Reference

### Invocation
> "Let's use Jimmy's Workflow to execute this plan"

### Pattern
```
🔴 PRE-FLIGHT → 🔴 IMPLEMENT → 🟢 VALIDATE (with reasoning) → 🔵 CHECKPOINT (with confidence)
```

### Pre-flight Status
- 🟢 **CLEAR**: All context available, proceed
- 🟡 **GAPS**: Some context missing, document and request
- 🔴 **BLOCKED**: Critical context missing, cannot proceed

### Confidence Levels
- **HIGH**: Proceed automatically
- **MEDIUM**: Human spot-check recommended
- **LOW**: Human validation required

### Status Codes
- 🔵 **COMPLETE**: Validated with documented reasoning
- 🟡 **IN_PROGRESS**: Working on it
- 🔴 **BLOCKED**: Failed validation, LOW confidence, or missing context

### Critical Rules
1. **NEVER skip PRE-FLIGHT** - always verify context first
2. **NEVER proceed past a checkpoint until status is 🔵 COMPLETE**
3. **ALWAYS document WHY validation proves correctness**
4. **ALWAYS acknowledge what validation does NOT prove**
5. **ALWAYS disclose when AI validates AI-generated code**

---

## Benefits of v2.1

✅ **Prevents wasted effort**: Pre-flight catches missing context early
✅ **Explicit context inventory**: Know what you have vs. what you need
✅ **Reduces "started but stuck"**: Blockers identified before implementation
✅ **Catches AI blind spots**: Forced reasoning prevents circular validation
✅ **Appropriate human involvement**: Confidence levels guide where to focus
✅ **Honest uncertainty**: Weaknesses acknowledged, not hidden
✅ **Audit trail**: Full reasoning documented for review
✅ **Validity tracking**: Know when checkpoints need re-validation
✅ **COI transparency**: Clear when AI is validating its own work

---

## LOAD_ADDITIONAL

```yaml
if_task_involves:
  building_audit_prompts:
    load: "god-prompt-methodology-part1-v2.1.md"
    reason: "MAP structure and Assessment Quality Patterns"

  building_component_library:
    load: "god-prompt-methodology-part2-v2.2.md"
    reason: "CAP workflow, Finding Contract, lens development, confidence calibration examples"

  triggering_audit_at_checkpoint:
    load: "god-prompt-methodology-part1-v2.1.md"
    sections: ["Prompt Structure Template", "COI Disclosure"]

shared_patterns:
  validation_structure: "This document, Section: GREEN VALIDATE Phase"
  finding_contract: "Part 2, Section: The Finding Contract"
  confidence_examples: "Part 2, Section: Confidence Calibration Examples"
  preflight_check: "This document, Section: PRE-FLIGHT Check"

autonomous_rules:
  preflight_blocked: "stop_gather_context_first"
  preflight_gaps: "pause_request_clarification"
  preflight_clear: "proceed_to_implement"
  confidence_high: "proceed_automatically"
  confidence_medium: "pause_for_human_spotcheck"
  confidence_low: "stop_require_human_validation"
  security_code: "pause_regardless_of_confidence"
  ai_validating_ai: "flag_coi_recommend_human_review"
```

---

## Version Check (For Projects That Copy This File)

**If you COPIED this file to your project** (not referencing from platform root):

```bash
# Check if your copy is up to date
templates/tools/check-version.sh
```

**If out of date:**
- Your copy: v1.1 (example)
- Master version: v2.1
- What's new: See CHANGELOG.md in the templates repo
- To update: Replace this file with the latest from the [Ydun AI Workflow repo](https://github.com/ydun-code-library/Ydun_ai_workflow)

**If you REFERENCE this file** (e.g., `../JIMMYS-WORKFLOW.md`):
- ✅ Always up to date automatically
- No sync needed

---

**Document Version**: 2.1
**Last Updated**: January 2026
**Status**: Active Platform Standard
**Maintained By**: Jimmy + AI Coding Assistants
