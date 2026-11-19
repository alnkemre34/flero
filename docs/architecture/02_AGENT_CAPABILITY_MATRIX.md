# 02 — Agent, Skill & MCP Capability Matrix

**Date:** 2026-11-14 · **Purpose:** to record which capabilities were found, which were actually used in this planning phase, and which are planned per implementation workstream. Master §2 and the directive both require that no agent be listed as invoked unless it was.

## 1. Environment inventory

| Kind | Available (relevant subset) | Notes |
|---|---|---|
| Project files | `FLERO_MASTER_SPEC.md` (871 lines, read in full), `CLAUDE.md` (a generic copy of the global orchestrator rules, nothing project-specific) | Greenfield: no code, no git repo, no `.project-memory/` |
| Local runtimes | Python 3.14, Node 26 | Python runs the independent Shuffle reference |
| User agents (`~/.claude/agents`) | backend-database-engineer, codebase-explorer, design-director, devops-engineer, frontend-mobile-engineer, motion-specialist, premium-design-director, qa-security-engineer, research-analyst | Model tiers per `rules/model-routing.md` |
| Plugin agents (ECC) | architect, planner, security-reviewer, database-reviewer, typescript-reviewer, react-reviewer, code-reviewer, performance-optimizer, e2e-runner, a11y-architect, tdd-guide, silent-failure-hunter, type-design-analyzer | Several are code-review oriented and only useful once code exists |
| Built-in agents | general-purpose, Explore, Plan | |
| MCP | context7 (library docs), playwright, chrome-devtools (Lighthouse, traces), built-in browser, Claude in Chrome | No cloud-provider MCP and no Figma MCP. Design specs are written as tokens and prose, not Figma files (limitation L-2) |
| Skills (relevant) | superpowers (writing-plans, TDD, verification, systematic-debugging), ecc: api-design, postgres-patterns, database-migrations, backend-patterns, react-native-patterns, redis-patterns, deployment-patterns, security-review, e2e-testing, architecture-decision-records; design: ui-ux-pro-max, design-taste, emil-design-eng, animate-expo, advanced-animation-engineering, motion-design-system, vercel-react-native-skills, gestures; project-memory, project-bootstrap | Per `CLAUDE.md`: one primary skill per task, at most one supporting skill |

## 2. Executed in this planning phase (evidence)

| Workstream (directive) | Executor | Status | Output used in |
|---|---|---|---|
| A Product architecture, traceability | Lead orchestrator (this session) | Done | 01, 05, 08 |
| H Shuffle algorithm (independent verification) | `general-purpose` agent (Sonnet) | **Executed.** Wrote an independent exact-enumeration checker. The lead re-ran it: exit 0, 21.9 s | 11 §8, `evidence/shuffle_verify_spike.py`, `evidence/shuffle_verify_spike_output.txt` |
| G Security & privacy (identity-oracle threat model) | `ecc:architect` agent (Opus) | **Executed.** 20 oracle channels, 11 decision items | 10, DEC list in 00 |
| Compliance research (store policy, KVKK, 5651, 6493) | `research-analyst` agent (Haiku) | **Executed.** Several Turkish statute texts were unreadable and are marked UNVERIFIED | 10 §9, 20 |
| J UI/UX design direction | `design-director` agent (Sonnet) | **Executed.** "Fener Işığı" direction: tokens, card variants, motion | 14 |
| N Independent architecture review | `ecc:architect` agent (Opus), fresh context, reading docs 00–20 | Executed after the drafts (see 21) | 21 |
| B–F, I, K–M (mobile, backend, DB, realtime, notifications, Gold, admin, infra, QA) | Lead orchestrator | Done directly, not delegated | 03–09, 12, 13, 15–18 |

**Why B–F, I, K–M were not delegated:** they are tightly coupled. The database, API, realtime, wallet and Shuffle designs share one schema, one transaction model and one set of IDs. Splitting them across agents would have produced contradictory documents that then need reconciling (see `rules/model-routing.md`: "one well-briefed agent beats three vague ones"). The agents were reserved for work that is genuinely independent or adversarial: mathematical proof, the threat model, policy research, aesthetic direction and the critical review.

## 3. Cross-agent reconciliation (Phase 7)

| Conflict / overlap | Resolution |
|---|---|
| Threat model D1 (two directional threads) vs spec "one canonical conversation preferred" | Adopted as DEC-01 proposal. Consolidation happens once both sides are identified, which keeps the preference where it is safe (08 §3) |
| Threat model D2 (anonymous-scoped block) vs CONFIRMED bilateral block | Not silently adopted. Raised as DEC-02 with a conservative proposal, and the CONFIRMED rule stays in force until the owner decides |
| Threat model D9 (random-delay digests for anonymous follow/like) vs "near-real-time notifications" | Proposed a small jitter of 0–15 min and no grouping with message pushes, as DEC-16. The default is real-time unless approved |
| Threat model D6 + policy research (P2P value transfer risk) | Both favor a platform sink for unlock Gold → DEC-03 recommendation |
| Design direction's extra "Öne Çıkan" block caption above promoted rows | Allowed by A§3.7 ("no mandatory section headings") as an optional disclosure. Marked DEC-22 because it adds a visual separator |
| Design direction's one-time Plus sheen | Kept, gated by Reduced Motion. It does not animate during scroll, consistent with A§7.1 |
| Shuffle spike ambiguity: shortfall transfer formula (A§3.2) | Implemented as `n_L=min(n_L0,A_L)`, `n_R=N−n_L`. Mirror case when REMOTE is short. Verified non-harm under it |
| Policy research: Apple 1.2 "random or anonymous chat" | Elevated to RISK-01, the top launch risk (20), with positioning mitigations (DEC-21) |

## 4. Planned capability use per implementation milestone

| Domain | Primary executor | Supporting skill (max 1) | Reviewer |
|---|---|---|---|
| Shuffle core + reference | backend-database-engineer | superpowers:test-driven-development | ecc:architect (math review), independent Python reference |
| DB schema/migrations | backend-database-engineer | ecc:database-migrations | ecc:database-reviewer |
| Auth/sessions | backend-database-engineer | ecc:security-review | ecc:security-reviewer (Opus-level reasoning) |
| Wallet/IAP/Boost | backend-database-engineer | superpowers:test-driven-development | ecc:security-reviewer + ecc:database-reviewer |
| Realtime gateway | backend-database-engineer | ecc:backend-patterns | ecc:performance-optimizer |
| Mobile screens | frontend-mobile-engineer | vercel-react-native-skills | ecc:react-reviewer, ecc:a11y-architect |
| Motion | motion-specialist | animate-expo | review via advanced-animation-engineering profiling |
| Design system | design-director | ecc:design-system | premium-design-director only for onboarding, paywall and the flagship profile |
| Admin web | frontend-mobile-engineer | vercel-react-best-practices | ecc:react-reviewer, ecc:security-reviewer |
| Infra/CI | devops-engineer | ecc:deployment-patterns | ecc:security-reviewer (IAM) |
| QA/gates | qa-security-engineer | ecc:e2e-testing | ecc:pr-test-analyzer |
| Library docs | research-analyst / ecc:docs-lookup (context7) | — | — |

## 5. Limitations

- **L-1:** There is no cloud MCP. Cost figures come from public list-price knowledge and are estimates, not quotes.
- **L-2:** There is no Figma MCP. "Figma-equivalent" specs are delivered as tokens, layout specs and, at M1, coded component prototypes plus screenshot golden tests.
- **L-3:** The compliance research could not read several primary Turkish statute texts (5651, 6493, 6502). Those items are UNVERIFIED and need Turkish counsel.
- **L-4:** No load test or device test has been run. Every performance number in 17 is a target or an estimate until M8 evidence exists.
- **L-5:** The Shuffle spike covers small domains: A_L, A_R ≤ 8 for the enumeration and ≤ 12 for the allocator. A larger property-based domain and the production sampler's statistical gate remain release gates (18).
