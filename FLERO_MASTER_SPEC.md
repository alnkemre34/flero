# FLERO — MASTER PRODUCT, EXPERIENCE & ENGINEERING SPECIFICATION

**Version:** 1.0 | **Date:** 2026-11-14 | **Status:** Product baseline; architecture selection delegated; release subject to verification  
**Audience:** Claude Code and its specialist agents, design, engineering, security, QA, operations  
**Product:** FLERO — iOS and Android social discovery, anonymous/identified messaging and social relationships; web administration  
**Brand:** FLERO is the chosen working product name. Check trademark, domain, stores and handles before public launch; do not assume legal availability.

> **TOP-LEVEL DIRECTIVE FOR CLAUDE:** You own the **technology selection and technical architecture**. Product behavior, safety/privacy requirements, monetary invariants, UI/UX outcomes, and the locked Shuffle contract are binding. Framework names mentioned in historical documents are **not mandates**. Inspect the repository and installed Skills/Agents/MCPs; choose only relevant ones. First produce a justified architecture and implementation plan for approval; then implement in verifiable milestones. Never claim perfection, zero defects, guaranteed store approval or proven scalability without evidence.

## 0. Source of truth and priority

1. This FLERO master specification governs all non-Shuffle product modules and cross-cutting requirements.
2. **Appendix A — FLERO Shuffle Engine V5.2 LOCKED**, included verbatim below except for project-name substitution, governs all Shuffle, region, Standard/Plus/Boost discovery, placement, Boost purchase and related pricing/entitlement behavior. It overrides any general description in this master for that domain.
3. Later **explicitly approved** decisions recorded in a versioned change log supersede earlier ones; never infer approval from a suggestion.
4. Generated OpenAPI, code and tests implement these contracts; they do not redefine product decisions. Technical implementation recommendations inside Appendix A (such as a specific database feature) may be replaced **only** with a documented, demonstrably equivalent or stronger invariant-preserving solution. Business rules cannot be replaced.
5. Ignore historical `PRODUCT_SPEC.md` and V1–V5.1 Shuffle files as authorities: they contain superseded region cooldown, batch size, Boost scope, ranking and framework choices. Do not merge old defaults into this specification.

**Decision labels:** `CONFIRMED` = binding; `ENGINEERING CHOICE` = Claude chooses and documents; `LAUNCH GATE` = must be validated before release; `DECISION REQUIRED` = do not invent a user-facing policy; request owner approval or present an explicit conservative proposal. No implied authorization to deploy, spend money, register accounts, or publish to stores.

## 1. Product mission and immutable experience principles

FLERO is a distinctive, premium-quality social discovery and messaging network, **not a Tinder-style swipe or mutual-like-gated dating app**. Discovery uses a vertically scrolling **single column of compact, full-width horizontal profile cards**, not a photo grid. Card tap opens the profile; Like, Follow and Message live on the profile, not the card. The app supports both anonymous first contact and visible identity, voluntary identity reveal and friendships. Users may send unlimited free text messages subject to necessary anti-abuse safeguards; there is no Plus or Gold gate for basic text communication.

**CONFIRMED:** Android+iOS; Turkish-first and complete English localization; sign-up with email/password, Google, Apple; optional phone verification for risk; 18+ age assurance and affirmative, versioned legal consents; exactly two required account gender choices **Kadın / Erkek**; gender Shuffle filter only for Plus, locked upsell for Standard; optional profile photo; public profile photos free; in-chat photos cost recipient Gold to unlock, including persistent and one-view; sender can always view own photo for free; Gold transfers in chat exactly **one Gold per action**; all legitimate Gold sources can be transferred/spent subject to antifraud holds; Plus subscription and Gold-funded Boost are separate products; admin-operated banners on home; public like counts, irreversible one-time Like; privacy-first relationships.

**Never claim:** verified identity merely from Plus; guaranteed screenshot prevention; guaranteed impressions, guaranteed delivery times or exact uniform exposure without proof; privacy from a relationship intentionally disclosed by a product rule; an account's manually declared home region is GPS-verified.

## 2. Technology autonomy — deliberately NOT predetermined

**ENGINEERING CHOICE — Claude has full authority to select the technology stack** for mobile, backend, admin web, APIs, data stores, real-time delivery, queues, media, cloud/hosting, CI/CD, analytics and observability. React Native/Expo, Flutter, FastAPI, Go, NestJS, Zustand, PostgreSQL, Redis, Kafka, RabbitMQ, etc. are **candidates, not instructions**. No framework is mandatory merely because it appeared in an earlier SPEC. Existing code and compatibility must be inspected before replacement.

Evaluate at least two viable alternatives for each major architectural category, with: measurable fit, security, correctness, ecosystem maturity, mobile UX, cost at projected traffic, operational burden, vendor lock-in, maintainability, team productivity, and migration path. Prefer the simplest architecture that demonstrably meets requirements; do not introduce microservices or brokers for prestige. Modular boundaries, horizontal scale, failure isolation and migration strategy matter more than labels.

**Required pre-code deliverables:** `TECHNOLOGY_EVALUATION.md`, `ARCHITECTURE_DECISIONS.md` (ADRs), `SYSTEM_ARCHITECTURE.md` (trust boundaries and data flows), `SECURITY_PRIVACY_MODEL.md`, `SCALABILITY_AND_SLO_PLAN.md`, `API_DESIGN_PLAN.md`, `UI_UX_BLUEPRINT.md`, `IMPLEMENTATION_ROADMAP.md`, `RISK_REGISTER.md`. Review with owner before irreversible implementation decisions. State realistic assumptions (registered users ≠ concurrent users), reference workloads and budgets. The target is **1M+ registered accounts with an evidence-based growth path to high concurrent traffic**, not a fabricated fixed RPS guarantee.

**Skill/MCP/agent orchestration:** discover available tools, inspect relevant instructions, choose specialist agents for independent architecture/security/UX/algorithm reviews when useful; avoid loading or invoking everything. Delegate independent tasks, reconcile outputs under this spec, maintain one authoritative decision log. Tool suggestions never silently override CONFIRMED rules. Record what was actually tested and what remains hypothetical.

## 3. Premium design language and UX quality bar

**Outcome required:** coherent original FLERO identity, meticulously designed light and dark modes, high-quality typography and spacing, consistent component tokens, rich but restrained gradients, tactile micro-interactions, smooth 60/120Hz-capable scrolling where hardware permits, excellent empty/loading/offline/error states, accessible contrast and screen-reader labels, dynamic font scaling, keyboard-safe layouts, gestures, haptics, reduced-motion support, skeletons, subtle transitions and performance-aware animation. Do not copy Tinder or Connected2.me trade dress. Produce real Figma-equivalent design specifications, component states and implementable screen flows, not generic templates or placeholder UI.

**Card hierarchy:** BOOST_BLOCK cards visually lead with paid-placement label and tasteful premium accents; organically selected Plus cards have a clearly differentiated premium style and rank ahead of organically selected Standard cards; Standard cards remain polished. A Plus+Boost card retains premium identity within paid placement. Active Boost owner drawn into organic DISCOVERY does **not** get a paid-placement label. Never imply Plus is identity verification. Cards approximately compact 76–88dp tall, responsive to accessibility font sizes; avatar roughly 52–58dp; name, age only if allowed, region and safe short metadata. Whole card navigates to profile. Avoid embedded Like/Follow/Message buttons. All design states must match Appendix A's placement schema and ordering.

**Profile photo experience (non-optional feature, photo itself optional):** Instagram-quality selection from camera/library with permissions, 1:1 draggable/zoomable square crop, pinch zoom, pan, grid overlay, reset, preview, confirmation, progress, retry, cancellation, upload resume/recovery, proper EXIF orientation, color handling, HEIC/JPEG/PNG policy, optimized thumbnails, server-side re-encoding, privacy checks, safe moderation and removal/replacement. Store square source crop; render circular avatar where appropriate. Preserve original until safe completion; no accidental loss or blurry crop; handle weak networks, large images and accessibility. No mandatory avatar to register.

**Screens:** splash/onboarding; sign-up/login/age/consent; city/district selection; optional photo editor; home with banner carousel; Shuffle list and filter/paywall; public profile and edit profile; follow/following/friends (owner-only visibility as below); anonymous message requests; inbox and conversation; locked photo send/view/unlock; Gold gift confirmation; Gold wallet/store/transaction history; Plus paywall; Boost catalog/quote/confirmation/status; notifications; account/privacy/safety/blocked users; session management; report/appeal/support; admin web. Define navigation graph, transitions, role/entitlement variants, error/loading/empty/offline states and screenshots/visual acceptance checks for each.

## 4. Identity, privacy, social graph and friendship

**Accounts:** immutable opaque public IDs, normalized unique handles, display name, required female/male selection, declared home city/district, optional profile photo and optional bio; stable internal IDs never directly authorize access. Email verified, provider OIDC verified, account linking protected from takeover; reset, revocation, refresh rotation, device/session list and sign-out-all. 18+ assurance must be meaningful, privacy-preserving and reviewed for legal compliance. Keep minimal age-verification proof rather than unnecessary DOB/biometric retention. Terms/privacy version, timestamp, locale and explicit acceptance; optional marketing consent separate. Gender visibility is public in product; support-controlled correction only. Prevent underage access, impersonation, spam and abuse with graduated controls.

**Follow:** directional, idempotent, no duplicate edge; follow notifications are anonymous (“Bir kişi seni takip etti”), with no identifying link. Follower list/identities are never globally exposed; only follower count is public. Owner can see whom they follow. **Intentional limited disclosure:** on a profile, `Seni takip ediyor` may show that the viewed account follows the viewer, and relationship discovery/enumeration is a known privacy tradeoff. Implement account/IP/device rate limits, abuse monitoring, anti-scraping and privacy-safe responses; do not promise absolute follower anonymity.

**Friendship:** derived solely from mutual follow. Mutual friends and friend count are visible **only to the owner** (authorization enforced server-side, not hidden by UI). Friends can recognize one another; mutual follow creates an identified relationship. A confirmed product decision permits permanent reveal of any existing anonymous thread when the pair becomes mutual followers; both sides must be given generic, non-oracular disclosure before their own follow action and clear confirmation when mutual occurs. The disclosure must not expose whether a particular anonymous conversation exists before authorization. Once revealed, identity cannot be re-hidden by unfollowing. A privacy/security review must explicitly model inference via relationship buttons and notifications; do not promise unobservable mutual status.

**Likes:** one irreversible like per ordered user pair; no unlike UI/API; unique constraint; public count, anonymized liker notification; legal erasure/moderation exceptions. **Blocks:** bilateral suppression from Shuffle/search/chat/follow/like/Gold transfers; remove follow edges both ways; no auto-restore after unblock. Old messages retained under applicable policy, read-only/archivable; report evidence handled separately. All actions concurrency-safe.

**CRITICAL ANONYMITY BOUNDARY:** recipient must never learn anonymous initiator's identity from public profile actions, API fields, search, mutual relationship state, push, transfer history, media URL/metadata, analytics, admin exports or error codes **before an authorized reveal**. Because social relationship signals can reveal pairwise identity, design and test each channel against realistic enumeration/oracle attacks. If an explicitly confirmed social disclosure makes absolute anonymity impossible in a particular case, document it honestly and give users understandable warnings; do not secretly weaken either rule.

## 5. Conversation model and messaging UX

**Anonymous initiation:** A taps B's public profile and starts text chat. A always knows B; B initially sees “Anonim Kullanıcı”, not A's profile. A can select `Profilimi Göster` to irreversibly reveal identity. A confirmed mutual-follow event can also permanently identify the existing conversation. Once identified, normal identity-visible conversation behavior applies. Anonymity applies to **all** surfaces and notification payloads, not only chat header.

**Conversation uniqueness and identity-oracle policy:** one canonical pairwise conversation is preferred to avoid fragmented chat history, but it must not cause a recipient visiting an anonymous initiator's public profile to see `Mesaja Git` or any signal that exposes the anonymous initiator. The sender's own navigation can show `Mesaja Git`; the recipient sees only an anonymous inbox thread until authorized reveal. If both directions attempt first contact before reveal, backend must resolve to a single safe conversation and preserve initial roles without emitting identity-correlating profile signals. Produce a formal state diagram and adversarial tests before coding; if a UX requirement cannot coexist with this privacy boundary, mark `DECISION REQUIRED` rather than invent a leaky shortcut.

**Requests:** new unknown/anonymous conversations arrive in **Mesaj İstekleri**; recipient accepts to move to main inbox, rejects/blocks/reports as desired. Sender can send messages without an artificial pre-acceptance message-count cap (confirmed preference), but safety rate limits, spam detection and user controls apply. No paywall on text. Define sender/recipient behavior on reject, accept, block, account deletion and multi-device race. Anonymous sender must be blockable/reportable from conversation ID without exposing their user ID; backend resolves the participant securely. Inbox supports archive, mute, unread, request filters and robust search that does not leak identity.

**Reliable low-latency messaging:** optimistic send UI with client idempotency key; server durable commit and per-conversation ordered sequence before ACK; transport may redeliver, effect must be idempotent. Explicit `sending → sent → delivered → read` states, monotonic delivery/read watermarks, multi-device reconciliation, background/resume sync, offline queue and retry with backoff, pagination, edits/deletes only if explicitly approved, typing TTL/heartbeat and stop-on-blur, safe push fallback. Push provider acceptance is **not** recipient delivery. Distinguish connection status from last seen and avoid presence-based anonymity leaks. Read receipts visible to both parties. All status changes tested under disconnections, duplicate events, reconnect, clock skew and concurrency. Define measured p50/p95/p99 SLOs and load conditions in architecture phase.

**Retention baseline:** message text **12 months**, media **90 days**, subject to legal holds, deletion rights and published policy. Retention job must be safe, auditable and idempotent; clients show expiry when applicable. Encrypted in transit and at rest, strict access controls, minimized logs, content moderation/report flows. Do not promise end-to-end encryption unless designed and implemented across every supported feature.

## 6. Chat photos, one-view media and Gold unlock

All photos **sent in chat** are locked for the recipient until they spend the configured Gold amount. This includes persistent and single-view photos, regardless of sender subscription or friendship. **Sender pays nothing to see their own photo**; public profile images remain free. A recipient can send 1 Gold to the other chat participant in a separate, explicitly confirmed transfer action to help them unlock content. No alternative free unlock route. Show clear Gold cost before unlocking; content safety scan and report options remain accessible without requiring Gold to report abuse. If a blurred preview is offered, it must not expose restricted content or bypass the Gold requirement. No misleading claim of knowing photo content before unlock.

Persistent unlock grants a durable entitlement; repeated taps do not re-charge. One-view unlock requires a server-controlled single-consumption state, explicit opening semantics, short reconnect grace when rendering failed, and no accidental consumption before successful render. Never treat device-only flags as authority. Secure short-lived access URLs, object access policy, malware/abuse checks, deletion, metadata stripping, encrypted storage, delivery optimizations. Screenshot prevention is best effort only, not guaranteed on iOS or against external cameras. Protect recipient from prohibited content through moderation and enforce refund/dispute policies without creating a free viewing loophole.

## 7. Gold wallet, transfers, Plus and Boost purchases

**Gold acquisition:** users acquire Gold through platform-approved in-app purchase, admin gifts, promotional rewards, subscription benefits and transfers. All Gold types can be spent and transferred; one user-visible available balance, with privileged provenance and append-only ledger. No cash redemption representation. Validate store receipts/notifications server-side, refunds, chargebacks, replay and duplicate purchase events. Follow platform billing policies and applicable consumer law; legal/compliance review is a launch gate.

**Gold transfers:** exactly **1 Gold per individual user-confirmed chat transfer**; sender balance decreases and recipient increases atomically, with immutable balanced ledger entries and unique idempotency. No quantity picker or bulk-transfer loophole. Both chat participants may send; no Plus requirement. Blocked/suspended accounts cannot transfer. Handle concurrency, low balance, duplicate taps, network retries, suspicious velocity, chargebacks and innocent downstream recipients. Never silently create negative available balance or confiscate unrelated funds; risk holds/debt/review policies and audit are mandatory. Transfer history in anonymous threads must not reveal sender's hidden identity.

**Plus:** monthly/yearly subscription, entitlement verification and expiry, premium themes/card styling, preferred display order after organic selection, broader eligible city discovery, Plus-only gender filter, Plus-only city Boost eligibility and configurable bonuses. Explain actual benefits in paywall; no identity-verification claim. Store renewal, grace, cancellation, refund, billing retry and downgrade semantics must be explicit.

**Boost:** activated **only by spending already-available Gold**, not a direct store payment at activation. Standard can buy home DISTRICT Boost; Plus can buy home DISTRICT or home CITY Boost; at most one overlapping Boost, no queue, no future schedule, no stacking. Quote includes package, scope, fixed location, Gold price, duration, honest small-market disclosure; accept with versioned quote and idempotency. Debit + ledger + entitlement in one atomic operation; no Gold loss without Boost or free Boost without debit. Immutable target geography, 30-day home-region change rule, no home change during active Boost, exact expiry, moderation/pause/outage/compensation and chargeback rules are governed in detail by Appendix A. Never guarantee exposure, likes or messages.

## 8. Notifications, home advertising and search

**Notifications:** near-real-time in-app + push for new message request, accepted request, identified and anonymous chat, typing only while in-app (no typing push), new photo, unlock, one-Gold gift, anonymous follow, friendship, profile reveal, Plus/Boost lifecycle, wallet and security, moderation. Permission education, device token registration/rotation, topic preferences, quiet hours, localization, dedupe, retries, deep-link authorization, background/terminated app support. Lock-screen copy must not reveal anonymous identity, private photo, transfer counterpart or sensitive message by default. Handle revoked push tokens and notification delivery limitations; no absolute delivery guarantee.

**Home:** beautiful, responsive admin-controlled banner carousel with scheduling, placement rules, localized assets, click destinations allowlist, frequency caps and sponsored disclosures. No intrusive overlays in active chat. **Search:** username exact/prefix, normalized and throttled, obey blocks/visibility and privacy; no user ID enumeration, follower-list reconstruction or anonymous-chat correlation. Plus-only gender filter belongs to Shuffle unless explicitly approved elsewhere.

## 9. API and cross-client contracts

Claude chooses API style/protocols, but MUST provide a versioned, documented machine-readable contract (OpenAPI for HTTP where applicable), generated typed clients, authorization scopes, structured error codes, stable opaque public IDs, strict validation, cursor pagination, request idempotency, backward-compatible evolution and schema tests. Specify all endpoints and realtime events from actual domain behavior, not copied stale URLs. Contract tests must cover forbidden fields and anonymity redaction, not only success codes.

Required capabilities: authentication/provider linking/sessions/reset; age and consent; account/profile/avatar crop/upload; home region and city/district reference; Shuffle and locked filter; follow/friends/likes/block/report; message requests, conversations, send/sync/typing/delivery/read/mute/archive; photo upload/locked access/one-view unlock; wallet/store purchases/transfers/ledger; Plus and Boost quotes/activation; push tokens/notifications/preferences; banners; admin moderation/finance/settings/analytics/audit; export/deletion and appeals. Design safe real-time event schemas with versioning and reconnect semantics. Never expose private IDs via overbroad serializers.

## 10. Admin panel — comprehensive premium operations console

Premium desktop-first web admin with polished dashboards, granular RBAC, mandatory MFA for sensitive roles, SSO where appropriate, scoped support access, immutable audit logs, approval workflows and explicit rollback. Modules: users/profiles, verified age and consent status (minimal data), bans/reports/appeals, anonymous conversation investigations with exceptional logged access, media moderation, city/district and entitlement catalog, Plus plans, Gold products and transfer risk, Boost packages/quotes/active entitlements/compensation, Shuffle configuration with hard validation, banner campaigns, push/email templates, localization, feature flags, operational health, queues, incident history, revenue reconciliation and privacy requests.

No unrestricted admin balance edit; ledger adjustments are explicit balanced transactions with reason/approval. Protect exports, prevent anonymous-identity leakage in ordinary support roles, redact PII, monitor suspicious staff access. Financial and paid-placement analytics must distinguish `NORMAL`, `SPARSE_COMPLETE`, `UNCERTAIN_PARTIAL` and separate card placement from actual viewport impression. Do not build per-viewer Shuffle histories to support analytics.

## 11. Security, abuse, compliance and trust

Mandatory threat modeling: anonymous sender identity oracle via `Seni takip ediyor`, `Mesaja Git`, mutual follow, notifications, wallet gifts, metadata, public search and admin export; scraping and enumeration; spam/harassment; child safety/age assurance; malicious media; account takeover; forged purchases; chargeback transfer laundering; broken access control; concurrency; data exfiltration; supply-chain risk. Rate limits and anomaly counters are allowed; Shuffle result caches and per-viewer seen lists are not. Sensitive wallet/Gold operations must fail safely when antifraud/coordination dependency is unavailable. Privacy by design, least privilege, secret rotation, encryption, secure mobile storage, dependency scans, SAST/DAST, incident response, backups and tested restoration.

**Launch gates:** independent review of Apple/Google policies for anonymous/random chat, UGC moderation and billing; Turkish KVKK and applicable 5651/social-network obligations; consumer rights, Gold transfer restrictions, age assurance and international privacy laws as applicable. Store approval cannot be guaranteed; position as moderated social discovery with profiles, follows, safety controls and meaningful reporting, not unmoderated anonymous roulette. Implement user block/report from anonymous conversation without requiring visible sender ID. Establish published Terms, Privacy, Community Rules, refunds and retention policies.

## 12. Reliability, scalability, performance and operations

Plan for 1M+ registered accounts and traffic growth through capacity models for DAU, peak CCU, active WebSocket connections, messages/sec, Shuffle requests/sec, media GB/day, push volume, database writes, Gold transactions and admin queries. Separate availability objectives for auth, messaging commit, realtime delivery and discovery; align dependencies and SLO mathematics. Define load profiles (normal/peak/burst), budgets, p95/p99, backpressure, queue saturation, hot keys, indexes, query plans, sharding triggers if necessary, connection limits, autoscaling, rolling deploys, disaster recovery RPO/RTO, multi-zone resilience and cost. Test with realistic geography skew and small pools, not just uniform fake data.

Reliability rules: durable outbox where needed, retry + dedupe, poison-event handling, graceful Redis/queue outages, strict financial consistency, message replay after disconnect, safe data retention, schema migration discipline, dashboards/tracing/alerts and runbooks. Never promise zero downtime or 100% delivery; measure and report.

## 13. Verification and acceptance gates

No feature is done merely because code compiles. Required: unit/integration/E2E/contract tests, security/privacy regression, concurrency and failure-injection tests, accessibility/device matrix, app startup and animation frame-rate measurements, media quality tests, push in background/terminated states, store purchase sandbox flows, backup/restore drill and load tests. **All Appendix A Shuffle invariants and its mandatory enumerator/property/statistical test suite are release gates**, including Boost non-harm under specified assumptions, capacity proof, Standard/Plus/Boost ranking, sparse mode, exact Gold debit and Boost time boundary.

Acceptance examples: 8 eligible profiles (6 Boost, 1 Plus, 1 Standard) and N=10 => show all 8, rank Boost→Plus→Standard, no duplicates; 1000 eligible and N=10 => normal paid priority target and fair organic eligibility; Plus alone does not increase draw probability, but ranks before Standard after draw; Standard cannot access Plus gender filter; no recipient-side `Mesaja Git` oracle for anonymous sender; exactly one Gold transfer per confirmed tap; sender sees own photo without Gold; one-view media cannot be replayed; no push leaks; no double wallet debit under retries. Test cases must explicitly state assumptions and expected output.

**Release evidence:** independent code review, passing CI, measured load results, verified app/device screenshots and accessibility, documented residual risks, legal/store review and owner signoff. If a claimed invariant fails, block release rather than editing the spec silently.

## 14. Implementation stages and Claude's first response

**Stage 0:** Read this file fully including Appendix A; inspect repo, tools and existing documentation. Produce requirement traceability matrix, contradiction report, threat model and proposed architecture/stack comparisons. Distinguish product commitments from implementation examples. **Do not start coding before architecture approval.**

**Stage 1:** Create detailed screen inventory, navigation diagrams, design tokens, premium component prototypes and API/data/event contracts; review and approve.

**Stage 2:** Build foundation (auth, age/consent, sessions, regions, profiles/avatar editor, observability, security, CI/CD) with tests.

**Stage 3:** Social graph and anonymity-safe conversation requests, realtime messaging, push, reporting/blocking, moderation; test privacy boundaries.

**Stage 4:** Wallet ledger, Gold purchase/transfer, Plus subscriptions, media unlock, Boost lifecycle and locked Shuffle algorithm; test concurrency/math and payment recovery.

**Stage 5:** Admin, analytics, ads, localization, polish, performance tuning, resilience, store/legal checks and staged launch. These are **delivery stages, not permission to omit** monetization or premium features from the final scope. Reorder work if dependencies demand it; justify changes.

**First Claude deliverable:** (1) concise product comprehension, (2) conflicts/true open decisions, (3) recommended technology stack with alternatives and ADRs, (4) architecture diagram/data flows, (5) security and scale risks, (6) detailed implementation roadmap, (7) exact acceptance/verification strategy, (8) questions requiring owner approval. Use installed Skills/MCPs/Agents selectively. Never substitute broad claims of “enterprise-grade” for testable evidence.

## 15. Change control and known tradeoffs

**LOCKED:** Appendix A product logic; Boost→Plus→Standard presentation order; adaptive sparse completeness; Gold-only Boost; 30-day home region cooldown; no Boost retargeting; anonymous sender redaction; free text chat; owner-only friend list/count; one-way follows; irreversible Like; 1-Gold transfer; photo unlock cost; premium UX outcomes. Changes require explicit product-owner approval, migration analysis, updated acceptance tests and changelog.

**Explicit tradeoffs:** follower pairwise labels and mutual-follow identity can enable inference; no product can promise total anonymity against deliberate social interaction; sparse markets may show all boosted profiles with paid labels; independent Shuffle batches can repeat; Plus position improves expected visibility without altering organic draw probability; absolute screenshot prevention is impossible. Document these plainly in privacy, UX and risk registers.

**Remaining decision gates to flag, not improvise:** exact age-assurance vendor/process; whether any public follower/like metadata needs additional privacy restrictions; specific conversation state behavior for two simultaneous opposite-direction anonymous starts if proposed solution cannot meet the oracle-free invariant; store/regulatory interpretation of transferable purchased Gold; operational budgets and quantified SLOs; precise user-facing refund terms. These do not permit abandoning confirmed functionality.

---

# APPENDIX A — FLERO SHUFFLE ENGINE V5.2 LOCKED CONTRACT

**Normative inclusion:** The following complete Shuffle specification is included as the authoritative detailed domain contract. Its product rules override older Shuffle versions and generic master summaries. Technical stack mentions in the appendix are implementation examples under §2 technology autonomy; equivalent invariant-preserving engineering solutions are allowed with ADR and tests.

# FLERO — SHUFFLE ENGINE: FINAL PRODUCT & ENGINEERING SPECIFICATION

**Version:** 5.2 · **Date:** 2026-11-13 · **Status:** LOCKED PRODUCT CONTRACT; mathematical/production verification remains a release gate  
**Audience:** Claude Code, mobile/backend/admin engineers, security, design, QA, SRE  
**Scope:** Shuffle discovery, Standard/Plus/Boost entitlement, geography, gender filtering, random sampling, placement, cards, admin controls, abuse protection and acceptance testing. This document does NOT replace the messaging/social/privacy/ledger specifications.

> **MANDATORY FOR CLAUDE:** Build to this spec, not to outdated Shuffle sections in older files. Don't silently invent product behavior. Correctness, privacy, economic integrity and measurable performance outrank cosmetic shortcuts. A “perfect” algorithm cannot guarantee zero latency, exposure, fairness under all arbitrary changing populations, or absolute protection from scraping; this document states precise guarantees and their boundaries.

## Release 5.1 — binding product decisions

**Decision status: CONFIRMED.** A declared home region is the user's social residence, not a free discovery switch. First selection at signup is allowed; thereafter a change requires **30 full days** since the initial selection or latest authorized change, and **no active Boost**. Paid Boost purchases are tied to their originally purchased geography and **cannot be transported**, including by support correction. Plus can still browse different districts and citywide within the chosen home city without changing residence. No GPS verification is required. Users are not told that their self-declared residence is verified.

**Commercial integrity:** Boost is activated exclusively by spending in-app **Gold already credited to the user wallet**, never by a direct Apple/Google payment at the Boost step. An active Gold-funded Boost cannot be lost through an automatic region reassignment. A user needing an exceptional region correction during Boost must go through reviewed support remediation that **does not relabel the existing Boost**. Any discretionary credit/refund/expiry handling must follow the billing/refund policy and documented approval; do not silently cancel or confiscate a purchased entitlement. A self-service region change request must always be blocked during an active Boost.

**Administrative safety:** configured NORMAL-mode priority-seat target ratio is bounded **5–40%**, NORMAL district locality target **50–90%**, and remote target is always the complement. **These configuration bounds do not cap the actual number of promoted cards in SPARSE_COMPLETE.** Limits are enforced server-side and are not bypassable through feature flags, admin API or stale config. Rollback must validate limits too.

**V5.2: SERVER-BOUND ADAPTIVE population mode.** If the **provably complete eligible population** has fewer than the authoritative server-configured batch size, return **every** eligible profile. All surface-qualifying active Boost holders are first, then remaining Plus members, then remaining Standard members; within each group randomize. Do **not** apply 30% priority-seat quota or 70/30 geography quotas in this sparse-complete mode. If the eligible population is at least the server-configured batch size, use the normal two-stage allocation: reserved Boost placement then remaining DISCOVERY, with DISCOVERY Plus cards before DISCOVERY Standard cards. In both modes the Boost label is placement-specific, not mere entitlement. The change does NOT allow non-qualifying district Boosts to receive CITY priority. SPARSE_COMPLETE paid priority remains explicitly labeled as a paid rank placement even when most or all cards qualify; its actual ratio is not the NORMAL quota.

**Prior V4.2 corrections retained (with V5.1 NORMAL simplification):** capacity is proved before selection; NORMAL priority seats are computed from fixed server N and SPARSE_COMPLETE has no percentage quota; home-region changes use one canonical timestamp; only one Boost can be active at a time, with no scheduled or queued Boost purchases; Gold debit and Boost activation form one atomic, idempotent ledger operation. Store purchases are solely for buying Gold (or separate subscription offerings), NOT the Boost activation itself.

**V5.2 binding hard rules:** The client cannot specify or influence `shuffle_batch_size`, SPARSE/NORMAL threshold, or priority allocation. The backend has one versioned `shuffle_batch_size` configuration (default **10**) and uses `N=shuffle_batch_size` as both batch return target and the sole adaptive-mode threshold. Plus has a genuine **post-selection ranking advantage** over Standard: boosted-priority cards first, then discovery Plus, then discovery Standard; this is distinct from selection probability. Purchased Boosts are charged only in Gold, and Boost checkout universally explains viewer-dependent small-pool behavior without asserting a market-wide sparse status. Boost runtime validity is time-based, not dependent on an asynchronous expiry job.

**Known limits:** organically placed holders of an unexpired city Boost may be inferred indirectly from their displayed remote district and Standard tier. The `badge.promoted` label describes *actual paid placement*, not secrecy of Boost ownership. Infinite scroll may repeat identities across independent batches by design. Exact uniform sampling and Boost non-harm remain objective, separately verified release gates, not magic guaranteed by a written document.

## 0. Decision registry and definitions

### 0.1 CONFIRMED non-negotiable rules

1. **UI:** one vertically scrolling column of narrow, full-width horizontal profile cards; NOT Tinder swipe, NOT a grid; tapping a card opens profile; no Like/Follow/Message controls inside a Shuffle card.
2. **Standard:** home district discovery only. Eligible candidates: Standard/Plus whose **home district is that district**, plus eligible **remote Plus users or remote holders of a currently valid city Boost** in the same city. A Standard account cannot select another district or city by changing request parameters.
3. **Plus:** can discover a chosen district in its home city or all eligible profiles citywide. Changing its discovery view is free and immediate; changing *home city/district* is subject to a strict 30-day restriction for both tiers, measured from account setup or most recent authorized change. Plus can filter `ALL`, `FEMALE`, `MALE`; Standard gets `ALL` only, with locked paid options in UI.
4. Gender on accounts is mandatory and exactly `FEMALE` or `MALE` in this product; visible in profile. No self-service gender change; legitimate correction through controlled support pathway.
5. **Plus != Boost.** Plus provides geographic eligibility, premium presentation **and preferred display order AFTER selection**, ahead of Standard DISCOVERY cards but behind BOOST_BLOCK; Plus does not increase the chance of being drawn into DISCOVERY solely because of its tier. Boost grants a chance at paid **priority placement** on eligible surfaces. An active city Boost continues its bought scope until expiry even when Plus expires; it does not preserve any other Plus entitlement.
6. In **NORMAL mode only**, default `priority_slot_ratio_bps = 3000` (=30%): first `Q` positions are **reserved for eligible Boost selections**, subject to available supply. Remaining positions are **DISCOVERY positions sampled from ALL eligible accounts not already selected**, including eligible Boost holders not selected for priority. Hence **more than 30% of returned cards may belong to Boost holders**; 30% is the reserved **slot** target, not a cap on Boost owners, impressions or reach.
7. In **NORMAL district mode only**, list target mix is `70% LOCAL / 30% REMOTE` **across the entire returned batch** (not independently re-applied to two list halves). In-city Plus is LOCAL and is counted only once. If a stratum has too few eligible candidates, vacant seats flow to the other stratum. Ratios are targets, not guarantees during shortage.
8. District Boost applies **only to its particular district discovery surface**; city Boost applies to **citywide discovery and all district surfaces within its city**. A district Boost holder can still be sampled as a normal DISCOVERY card in a Plus citywide view, without paid priority there.
9. At most one instance of a public user ID per **individual API batch**. Between independent requests/pages/refreshes, the same user **may legitimately recur**; do not save per-viewer seen IDs, session history, Shuffle result arrays, or per-viewer ranked feeds on server **or client**. Client may prevent duplicate processing of **the same response** only.
10. Boost and DISCOVERY cards differ by **placement**, not a global boosted badge. `BOOST_BLOCK` receives the paid-priority accent/“Promoted” label; a Boost holder sampled into `DISCOVERY` looks like a normal Standard or Plus profile. The owner sees their own active Boost in their own account UI.
11. **Gold-only Boost:** users first acquire Gold in their wallet (including store-purchased, gifted, promotional or transferred Gold); Boost activation debits a published Gold price from the authoritative available balance. There is **no direct card/store charge** when pressing Activate Boost. Every Gold source is spendable and transferable subject to fraud/security controls; no source-based spending restrictions. One globally active Boost per account; no stacking, extension, schedule or queue in V5.1. No claim of guaranteed impressions, likes, chat initiation, 1.5x views or universal equal per-user exposure. Block/privacy/moderation/eligibility wins over purchases.
12. **Home city/district is an account residence attribute, NOT a browsing control.** It can be changed no more than once per rolling 30-day period (first signup selection starts the clock). **No home-region change while ANY active Boost is running.** A Boost is permanently bound to the city/district purchased; it NEVER moves or changes geographic target, duration, or scope after purchase. Plus may browse home-city districts/city freely. No mandatory GPS check; the location is self-declared and is not a verified residence claim. Controlled support corrections require a full audit, cannot transport an active Boost, and cannot bypass payment rules.
13. Shuffle has no server-side viewer-profile exposure history. Short-lived aggregate security counters and anonymous aggregated impressions (without viewer IDs) are allowed.

### 0.2 Terminology

- `V`: authenticated viewer; `U`: candidate profile; `home_city(U)` / `home_district(U)`: authoritative home region.
- `P(U)`: Plus **currently active** at the time of an eligibility check.
- `C(U,c)`: valid, unexpired **CITY** Boost entitlement for city `c`, including a purchased Boost protected after Plus expiry.
- `D(U,d)`: valid, unexpired **DISTRICT** Boost entitlement for district `d`.
- `visible(U,V)`: active/discoverable/moderation-cleared, matches gender, is not self, has no bilateral block, and has no other applicable privacy exclusion.
- `LOCAL`: eligible profiles home-registered in selected target district.
- `REMOTE`: eligible profiles in other districts of selected target city **whose Plus is active OR whose city Boost is valid**.
- `BOOST_BLOCK`: profile was selected into a designated paid-priority slot **for this request**; `DISCOVERY`: selected via the general sampling stage.
- `N`: authoritative server `shuffle_batch_size` (client cannot override it); `A_total`: eligible distinct population on the selected surface; `n_s`: target total seats in stratum `s`; `q_s`: reserved Boost seats in stratum `s`.
- `sampling`: independent random selection for each request, with no memory of prior samples.

## 1. Authoritative discovery/eligibility matrix

| Viewer | Mode | Candidate eligibility | Qualifying paid priority |
|---|---|---|---|
| Standard | Own district | `LOCAL` (Standard + Plus) ∪ `REMOTE` (active Plus OR active city Boost) | Local qualifying district or city Boost; remote qualifying city Boost |
| Standard | Other district / City | **REJECT** | — |
| Plus | Any district of home city | `LOCAL` ∪ `REMOTE` as above | Local qualifying district or city Boost; remote qualifying city Boost |
| Plus | Entire home city | **All visible accounts** registered in home city, regardless of subscription | Valid **city Boost only** |
| Plus | Other city | **REJECT** | — |

**Exact predicates (district mode):**

```text
LOCAL(V,d) = { U | visible(U,V) ∧ home_city(U)=home_city(V)
                      ∧ home_district(U)=d }

REMOTE(V,d) = { U | visible(U,V) ∧ home_city(U)=home_city(V)
                       ∧ home_district(U)≠d ∧ (P(U) ∨ C(U,home_city(V))) }

ELIGIBLE_DISTRICT = LOCAL ∪ REMOTE    // disjoint by district
PRIORITY_LOCAL = { U ∈ LOCAL  | D(U,d) ∨ C(U,home_city(V)) }
PRIORITY_REMOTE = { U ∈ REMOTE | C(U,home_city(V)) }

CITY_ALL(V) = { U | visible(U,V) ∧ home_city(U)=home_city(V) }
PRIORITY_CITY = { U ∈ CITY_ALL | C(U,home_city(V)) }
```

- An active Plus member **without Boost** is DISCOVERY-eligible in its home district and remote district lists, but never a priority candidate solely for being Plus.
- An expired Plus member holding an active city Boost remains REMOTE-eligible and may be selected either for **BOOST_BLOCK** or ordinary **DISCOVERY** until Boost expiry. It displays **Standard styling** after Plus expiry, unless it earned `BOOST_BLOCK` placement.
- When that city Boost expires, it is removed from REMOTE unless Plus has been reactivated; it remains LOCAL (if otherwise eligible).
- An expired *district* Boost gives no priority anywhere. An active district Boost does not grant extra geographic reach.
- Active Boost does not overcome hidden profile, self, block, moderation, deleted/suspended account, city mismatch or a viewer's selected gender filter.
- Home-region change is rejected when **any** active Boost entitlement exists; no Boost target ever moves. An allowed change updates home assignment and discovery projection atomically, subject to the 30-day restriction.
- **Boost catalog:** Standard users may activate only a DISTRICT Boost bound to their registered home district. Active Plus users may activate either that home DISTRICT Boost or a CITY Boost bound to their home city. A Plus user browsing a different district cannot buy a district Boost targeting that other district. One active Boost across either scope. All activations cost Gold, never direct Boost payment.
- A person can have **at most one ACTIVE Boost globally**. A different scope does not bypass this rule. No future-start scheduled/queued Boost is offered. Historical expired/revoked Boost rows may coexist, but cannot affect priority. One candidate enters at most one geographical stratum and one priority set.

## 2. Configuration: precise terms and rounding

| Field | Default | Requirement |
|---|---:|---|
| `shuffle_batch_size` | **10** | Server-owned, versioned value; allowed values **10, 15, 20, 25, 35, 50** (max 50). No client input. This exact value is **also the SPARSE threshold N**. Any administrative change requires audited staged rollout and revalidation. |
| `priority_slot_ratio_bps` | 3000 | **500..4000** inclusive (5–40%); **priority reserved seats of actual eligible output**, not total Boost owner share |
| `district_local_ratio_bps` | 7000 | **5000..9000** inclusive (50–90%); seats for LOCAL across full district-mode batch |
| `district_remote_ratio_bps` | 3000 | Derived: `10000-local`, not separately editable |
| `home_region_change_interval_days` | 30 | **Fixed 30 days; non-admin-editable.** First registered home selection starts the clock. |
| `shuffle_history` | DISABLED | Hard immutable product invariant |
| `shuffle_session_dedupe` | DISABLED | Hard immutable product invariant |
| `placement_order` | BOOST_BLOCK_THEN_DISCOVERY_PLUS_THEN_DISCOVERY_STANDARD | Hard invariant |
| `adaptive_sparse_mode` | COMPLETE_ELIGIBLE_POPULATION_LT_SERVER_BATCH_SIZE | Mandatory. No client or per-request override. |
| `impression_guarantee` | NONE | Must be disclosed during purchase |
| `max_sampling_budget` | bounded, load-tested | May cause partial batch with `completion=UNCERTAIN`; never silently claim exhaustion |
| `boost_activation_currency` | GOLD | Immutable. Boost may be activated only via an atomic Gold debit; no direct external charge. |
| `max_active_boosts_per_account` | 1 | Immutable V5.2 global limit; no queue, stacking, extension or scheduled Boost. |

Use exact **half-up** integer rounding; never call Python's `round()`:

```python
def quota(n: int, bps: int) -> int:
    assert n >= 0 and 0 <= bps <= 10000
    return (n * bps + 5000) // 10000
```

| `N` | Priority seats `Q` (30%) | LOCAL total target (70%) | REMOTE total target |
|---:|---:|---:|---:|
| 10 | 3 | 7 | 3 |
| 15 | 5 | 11 | 4 |
| 20 | 6 | 14 | 6 |
| 25 | 8 | 18 | 7 |
| 35 | 11 | 25 | 10 |
| 50 | 15 | 35 | 15 |

**Normative mode boundary:** `N` is the server-published effective `shuffle_batch_size`, never a client field. Determine eligibility using a coherent authoritative snapshot. If exactly `A_total < N` can be **proved**, enter SPARSE_COMPLETE and return ALL eligible profiles, with all surface-qualifying Boost owners first, then Plus, then Standard; no percentage targets apply. If `A_total >= N` is proved, enter NORMAL and plan **exactly `N` seats**, with `Q=quota(N, priority_slot_ratio_bps)` and LOCAL target `quota(N, district_local_ratio_bps)`. If capacity cannot be proved within an operational budget, **never assume sparse**; use a correctness-preserving UNCERTAIN response or retryable failure. Do not infer population from a limited random candidate sample. If late safety revocation prevents filling `N`, never mislabel the response FULL; reconcile against the authoritative snapshot or mark UNCERTAIN and cap paid placement according to the actual safe partial response.

**Percentage contract:** `priority_slot_ratio_bps=500..4000` constrains the **configured NORMAL target**, not the fraction of Boost-owning cards, which may exceed the quota because owners can be drawn into DISCOVERY, and not the sparse-complete share. For supported NORMAL batch sizes use the exact integer quota; integer rounding can create small deviations from the configured percentage.

**Important:** `Q` and LOCAL are **independent targets for the same N-seat NORMAL result**. Do not compute 70% of Boost portion plus 70% of DISCOVERY portion separately; rounding those separately causes inconsistent totals.

## 3. Authoritative selection algorithm: quota-consistent, Boost-monotone

### 3.1 High-level contract

**MANDATORY priority order of rules:** (1) authoritative eligibility/safety, (2) evidence of actual population size, (3) SPARSE_COMPLETE if `A_total < N`, otherwise NORMAL, (4) placement-specific Boost treatment, (5) Plus-first/Standard-last display sorting, (6) per-batch uniqueness, privacy and completion semantics. An unproven candidate shortage never enables SPARSE_COMPLETE.

#### 3.1.1 Formal modes

```text
A_total = number of DISTINCT profiles satisfying the viewer's complete final
          eligibility predicate, across LOCAL+REMOTE or CITY_ALL, including
          all eligible Standard, Plus, and Boost-entitled profiles.
N       = server-controlled shuffle_batch_size; never client-selected.

if exact A_total < N:
    MODE = SPARSE_COMPLETE
    cards = ALL eligible profiles, each exactly once
    priority = {u in cards | has currently valid Boost QUALIFYING
                for this viewing surface}
    discovered_plus = remaining cards with active Plus
    discovered_standard = all other remaining cards
    order = shuffle(priority) ++ shuffle(discovered_plus)
            ++ shuffle(discovered_standard)
    priority cards placement=BOOST_BLOCK; remaining placement=DISCOVERY
    completion=EXHAUSTED; has_more=false
    # no 30% cap and no 70/30 LOCAL/REMOTE quota apply in this mode
else:
    MODE = NORMAL
    # use the authoritative fixed-seat, two-stage algorithm in §3.2–§3.4
    # select Q Boost priority slots and general DISCOVERY from all remaining
    # then output BOOST_BLOCK, DISCOVERY Plus, DISCOVERY Standard
```

**Important:** A city-mode viewer does not give district-only Boost holders priority even in SPARSE_COMPLETE; such accounts stay in their correct Plus/Standard discovery group. A city Boost belonging to an expired Plus account can qualify for paid priority/remote reach while presenting Standard-tier styling. No candidate becomes invisible because its class is Standard or Plus; within each correct eligible stratum these classes are both selectable. `A_total=N` enters NORMAL, though every profile is necessarily selected; only placement and display order can differ.

**Proof boundary:** SPARSE_COMPLETE inclusion probability is exactly 1 for every eligible profile. NORMAL inclusion probability must satisfy BOOST_NON_HARM under fixed eligible membership. A Boost conversion that changes the number of eligible profiles can change the mode; cross-eligibility changes require separate policy analysis rather than a false fixed-population monotonicity claim.


The **NORMAL-mode** algorithm has exactly two selection stages: **priority selection** then **general discovery selection**. Priority does **not** remove a user's eligibility for general discovery when they are not selected into priority.

**Principle:** For fixed eligible-population membership, district/city view, gender, blocks, home regions, configuration and other users' statuses, changing one account from no qualifying Boost to qualifying Boost **must not lower its probability of inclusion** in a batch. This is the `BOOST_NON_HARM` invariant. Separate exact proof and test gates apply (§4); do not announce this property met until the implementation passes them.

### 3.2 Fix geographic total seats before inspecting Boost state (capacity-proof contract)

In NORMAL, **`A_total >= N` has been proved, so the planned output capacity is exactly `N`**. Never compute `M=min(N,A_total)` or execute an unbounded full-population `COUNT(*)` solely to choose the mode. For DISTRICT, LOCAL and REMOTE are disjoint and include all eligible Standard/Plus/city-Boost users prescribed by §1.

1. Compute provisional stratum targets: `n_L0=quota(N,local_ratio_bps)`, `n_R0=N-n_L0`.
2. To fill a stratum target `t`, it is sufficient to establish an authoritative **lower-bound proof `A_s >= t`** with `t` distinct finally eligible candidates; no exact total needed. If a stratum cannot fill `t`, establish **complete indexed exhaustion**, obtain its exact smaller count, and transfer the shortfall to the other stratum only if its additional capacity is verified. In a genuine `A_total>=N` population, the other stratum must be able to make up the shortage; sampling-budget underfill is **not** evidence of exhaustion.
3. Stratum capacities must respect the current viewer's blocks, gender filter and visibility, not stale global directory sizes. Proofs may use indexed candidate directories with authoritative final verification. If proof cannot be completed within bounded work, report UNCERTAIN or a retryable error; **never assert an incorrect geographic capacity or sparse mode**.
4. Allocate `n_L,n_R` **without consulting Boost flags**, such that `n_L+n_R=N`, and freeze these totals for this draw. City mode is one stratum, `n_CITY=N`.
5. Draw priority and general candidates inside the frozen strata. A late safety change can invalidate a candidate; attempt bounded replacement and otherwise fail safely as UNCERTAIN. Do not leak blocked/hidden accounts.

**Reason for the boundary:** Changing Boost status cannot change total geographic seats while the eligible population remains fixed. If a city Boost introduces a previously remote-ineligible account, the population itself changed, so compare the resulting system under new eligibility rather than claiming fixed-population monotonicity.

### 3.3 Deterministic priority allocation with fixed geographic totals

For **NORMAL mode only**, let `N = sum_s(n_s)` and **`Q = quota(N, priority_slot_ratio_bps)`**. `N` is the server-controlled NORMAL batch size; SPARSE_COMPLETE does not call this allocator. If the algorithm finalizes fewer cards because of a race/late exclusion, it must recompute a consistent NORMAL-mode placement plan or return a fail-safe `UNCERTAIN` response with promoted count within `quota(actual_returned_count, ratio)`; never reclassify a paid slot as DISCOVERY while claiming paid priority, and re-check non-harm behavior in the fallback.

**Two-stratum reference allocation (never changes total geographic seats):**

```python
# All values are integer. n_L/n_R have been established using sufficient authoritative capacity proofs; exact total counts are not required for well-populated strata.
# n_L/n_R are fixed solely from eligible capacities (not Boost status).
Q = quota(N, priority_slot_ratio_bps)
base_L = min(n_L, quota(Q, district_local_ratio_bps))
base_R = min(n_R, Q - base_L)
# Repair the base split when one stratum lacks even total seat capacity.
unassigned = Q - base_L - base_R
add_L = min(unassigned, n_L - base_L)
base_L += add_L
unassigned -= add_L
add_R = min(unassigned, n_R - base_R)
base_R += add_R
unassigned -= add_R
assert unassigned == 0  # Q <= n_L+n_R

# Reserve only real, valid paid Boost candidates; initial geographical intent.
q_L = min(base_L, B_L)
q_R = min(base_R, B_R)
missing = Q - q_L - q_R

# Only one stratum can have genuine surplus after the initial capacity-limited split.
# Apply residual priority budget where available; neither tie-break nor dual-surplus branch exists.
add_L = min(missing, min(n_L, B_L) - q_L)
q_L += add_L
missing -= add_L
add_R = min(missing, min(n_R, B_R) - q_R)
q_R += add_R
missing -= add_R
# Any remaining missing become DISCOVERY seats, in their already fixed strata.
assert 0 <= q_L <= min(n_L, B_L)
assert 0 <= q_R <= min(n_R, B_R)
assert q_L + q_R <= Q
```

**Determinism:** the same counts/configuration must yield the same allocations. Randomness applies only to identities selected into the resulting seats. Under the two-stratum capacity-limited initialization, both strata cannot simultaneously need the same remaining priority allocation: no imaginary dual-surplus tie-break is specified. No Boost status may alter `n_L/n_R` while the eligible populations stay fixed. City mode: `q_CITY = min(Q,B_CITY,n_CITY)`.

**Monotonicity obligation:** activating a candidate's qualifying Boost inside an already-eligible population cannot reduce the candidate's `n_s` or `q_s`, but those conditions alone are not a substitute for a proof of the *full inclusion probability*. Apply the exact-toggle enumeration and property tests in §9. If they identify a counterexample, release is blocked; never weaken the requirement to fit the implementation.

**Small-batch rounding:** exact half-up integer rounding is intentional. `Q=2`, 70% locality target gives **1 LOCAL/1 REMOTE**, not 70/30. Ratios are integer-seat targets, not per-request exact proportions, and are not compensated by maintaining per-viewer history.

### 3.4 Priority selection and general discovery selection

For each stratum `s` with fixed `n_s, q_s` in **NORMAL mode**:

1. Uniformly sample `q_s` **distinct qualifying Boost** candidates from that stratum, post-filtered for visibility and user blocks. Assign `placement=BOOST_BLOCK`.
2. Uniformly sample `n_s-q_s` distinct candidates from **ALL remaining eligible profiles** in that stratum, including active qualifying Boost holders not selected above, Plus members without Boost, and Standard members. Assign `placement=DISCOVERY`.
3. Never repeat any selected public ID in the same response; temporary `selected_ids` exists only in request memory and is discarded.
4. Randomize order inside `BOOST_BLOCK`. For DISCOVERY, partition into **currently active Plus** and **currently Standard**, randomize independently within each group, then concatenate `BOOST_BLOCK → DISCOVERY_PLUS → DISCOVERY_STANDARD`. Never let a Standard DISCOVERY card precede a Plus DISCOVERY card. This sorting changes ordering only, not inclusion probabilities or local/remote quotas.
5. A Boost holder selected into `DISCOVERY` **never gets a paid-priority badge or visual effect for that card**. Its Plus visual treatment remains if Plus is active.
6. If sampling budget is exhausted before a proven total candidate exhaustion, return a partial result marked `completion=UNCERTAIN`; never violate eligibility or claim the pool is exhausted.

**Never in NORMAL mode:** put all Boost holders into the priority block; exclude nonselected Boost holders from DISCOVERY; enforce `total_boost_holder_cards ≤ 30%`; sort users by follower count; increase Plus inclusion probabilities merely to implement the Plus-first **presentation order**. The Plus-first rule applies only after sampling.

### 3.5 Why priority allocation is monotone (and its exact limits)

For one fixed stratum with `A` eligible accounts, fixed `n` total seats and `q` priority seats, let `B` be the number of qualifying Boost accounts. If `B ≥ q`, define `r=(n-q)/(A-q)`. A **nonboost** account has inclusion probability `p0=r`; a **boost** account has:

```text
p1 = (q/B) + (1 - q/B) * r
p1 - p0 = (q/B) * (1-r) ≥ 0
```

This comparison assumes the same `A,n,q,B` *population model* when comparing account types; for an actual **purchase toggle**, `B` changes by one. Exact before/after probabilities must be computed with `B_before` and `B_after=B_before+1`, and `q_before/q_after` allocated by the actual algorithm. For `B < q`, all Boost accounts are selected into priority, so boosted inclusion is 1. `q_s` must be nondecreasing for a target's own Boost activation; regional total seats must be Boost-status-independent. Together these properties support the non-harm result in fixed-membership cases.

**Do not overstate proof:** When a city Boost adds a formerly invisible account to REMOTE, or when subscription expiry/home-region changes alter eligible membership, `A` and `n_s` may change. That is an entitlement-scope change, not the fixed-population Boost monotonicity theorem. No absolute cross-geo or cross-time per-account impression guarantee is made. A complete exact enumerator in §9 is required before calling this algorithm production-ready.

**Uniformity assumption:** Formulas require statistically uniform eligible draws from each logical pool. Random-key pivot with gaps or arbitrarily truncated candidate searches is **not** a proof of uniformity. An approximate index implementation must demonstrate acceptable divergence from an exact reference sampler and report its limits.

### 3.6 Worked examples

**Example A — 20 seats, local/remote fully stocked:** `n_L=14`, `n_R=6`; `Q=6`, base priority `q_L=4`, `q_R=2`. Draw 4 qualifying local Boost, 2 qualifying remote city Boost. Then draw 10 other local and 4 other remote **from everyone not already selected**. Boost holders may appear among these 14 DISCOVERY cards. Output: six BOOST_BLOCK on top, followed by 14 DISCOVERY cards.

**Example B — only 1 local Boost, many remote city Boosts:** Keep `n_L=14`, `n_R=6`. Initial `4/2` priority split becomes `1/5` if there are at least five remote city Boost candidates. LOCAL still contributes 14 profiles total; REMOTE still six; overall priority count stays six and is shown first.

**Example C — only 3 total qualifying Boosts:** All three may get priority placement on every independently fetched batch; remaining 17 seats are general DISCOVERY. Subsequent requests may repeat the three; this is intentional.

**Example D — 300 Boost / 600 nonboost, one city pool, N=20:** `Q=6`; six distinct Boost holders have priority. The remaining 14 are selected from the other 894 accounts (294 boosted, 600 not). Expected extra Boost holders in DISCOVERY = `14*294/894≈4.60`, so expected total Boost-holder cards ≈10.60 of 20 (53%). **Do not present 30% as a ceiling on Boost owners.**

**Example E — Plus expires during paid city Boost:** Person loses Plus border, Plus filters and citywide *viewing* but stays eligible in all districts in their home city and city Boost priority until the Boost's exact expiry; may also appear in DISCOVERY placements. At expiry remote reach ends unless Plus is active.

**Example F — Plus citywide viewer:** Exactly one `CITY_ALL` geographic pool; all eligible Standard and Plus accounts throughout city may be in DISCOVERY. Only active city Boost entitlements can fill `BOOST_BLOCK`; district Boost entitlements are irrelevant to citywide priority.

**Example H — SPARSE_COMPLETE wins over percentage caps (server N=20 fixture):** `N=20`, exactly eight eligible accounts, six surface-qualifying Boost owners (Standard and/or Plus), ratio 3000. Return **all eight**: six `BOOST_BLOCK` first in random order, then any Plus nonboost, then Standard nonboost. Here six of eight (=75%) can be labeled promoted; this is intentional and lawful within this product rule because the configured 5–40% limit governs NORMAL-mode *target* seat ratio, not SPARSE_COMPLETE rendered share.

**Example I — eight eligible accounts, ten-card configured batch:** `N=10`, exactly eight eligible candidates: `2 Plus+Boost`, `1 Standard+Boost`, `3 Plus`, `2 Standard`. Return all eight: first the 3 Boost holders shuffled amongst themselves, then all 3 nonboost Plus shuffled, then 2 nonboost Standard shuffled. `selection_mode=SPARSE_COMPLETE`, `completion=EXHAUSTED`, `has_more=false`; a manual refresh may reshuffle these same eight. If those eight include six qualifying Boost holders instead, all six Boost holders appear first, followed by the remaining Plus then Standard.

**Example G — local scarcity (server N=20 fixture):** If the local eligible capacity is 4 and remote capacity ≥16 for N=20, seat allocation yields 4 LOCAL + 16 REMOTE, regardless of Boost status. If only 4 eligible globally, return ALL four in SPARSE_COMPLETE, order by surface-qualified Boost → Plus → Standard, and prove exhaustion before `has_more=false`.

### 3.7 Presentation order as a formal post-selection operation

The **only** correct user-visible ordering, in both modes, is:

1. **BOOST_BLOCK:** surface-qualifying paid-priority selections, whether the owner is Plus or Standard. Shuffle within this block; no further Plus ordering.
2. **DISCOVERY_PLUS:** all selected ordinary-discovery profiles with *currently active Plus*, including any Boost holder that was not selected into `BOOST_BLOCK`. Shuffle within this block; render premium card styling, never a promoted label.
3. **DISCOVERY_STANDARD:** all other selected ordinary-discovery profiles, including Boost holders that failed priority placement or are not qualifying on this surface, and former Plus holders whose Plus expired. Shuffle within this block; standard styling, no promoted label.

**The UI is one uninterrupted narrow-card vertical list**: no mandatory section headings or gaps, only positional grouping. This product rule is sorting, **not** Plus quotas, not Plus inclusion weighting, not a ban on Standard accounts, and not a reason to remove unchosen Boost accounts from DISCOVERY. List ordering must not be delegated to client arbitrary `sort()` without consistent server `presentation_rank` / placement and status semantics. The API order is canonical; the client preserves it.

## 4. Scrolling, independent requests, completion semantics

- **Refresh:** request a new independent sample; replace current list. Repeats are allowed, no persistent seen-set on either side.
- **Infinite scroll:** append independent request batches; duplicates across batches are **allowed** and may appear multiple times as user scrolls. Never auto-filter legitimately repeated IDs across separate requests; use per-batch list keys e.g. `batch_nonce:public_user_id` so React Native renders independently.
- **Small-pool rule:** If the backend can **prove** `A_total < N`, use SPARSE_COMPLETE: return **all** eligible profiles, group-sort them, `completion=EXHAUSTED`, `has_more=false`. No 30% or 70/30 quota in this case. Refresh remains enabled. No “all profiles seen” copy.
- **Uncertain underfill:** If sampling query budget, stale candidate projection, blocked-candidate rejection or infrastructure limits cause partial underfill without a proof of exhaustion, return `completion=UNCERTAIN`, `has_more=true`; use a client-enforced max automatic immediate retry/backoff so a pathological pool never creates a rapid request loop.
- **Full batch:** `completion=FULL`, `has_more=true` by default. `has_more` does NOT promise new unique profiles in later batches. If a full batch (`A_total=N`) is also provably the full eligible set, the backend **must** mark `EXHAUSTED` and stop auto-pagination (refresh still available).
- A zero-result request with `UNCERTAIN` should show a transient retryable state, not “no users exist.” A zero-result `EXHAUSTED` should show a friendly region-filter empty state with refresh option.
- Do not use a cursor that stores profile IDs or acts as a view-history token. No Shuffle response cache, no per-user recent results, no global feed rotation.

## 5. Sampling infrastructure for high traffic

### 5.1 Correctness reference vs scalable implementation

Implement **two samplers** behind an interface:

1. **Reference exact sampler** for small populations/testing and for SPARSE_COMPLETE: enumerate eligible candidates, apply all privacy/block/geo/gender predicates, select by cryptographically strong uniform randomness without replacement; calculate exact eligible capacities. Use only under a proven small-pool threshold or in tests/offline validation. Avoid citywide `ORDER BY random()` in production.
2. **Production indexed sampler**: maintain membership directories / dense-slot indices or another verified near-uniform indexed structure, partitioned by city, district, relevant active Plus/city Boost eligibility, gender and qualifying Boost scope. Randomly choose an eligible slot (or weighted subpartition proportional to *exact eligible member count*), fetch candidate by indexed lookup, apply final authoritative safety checks, reject disallowed candidates and retry with bounded budgets. Rejected candidates must not be silently replaced by a fixed top-N prefix. Preserve uniqueness within a batch. **Do not store per-viewer histories or Shuffle results.**

**Recommended directory approach:**

- A citywide directory of discoverable members partitioned into manageable shards/segments for all-city sampling.
- District LOCAL directories for both genders and `ALL` queries (avoid duplicate *profiles within one result*, not necessarily duplicate index references).
- REMOTE source directories built from **deduplicated** active Plus OR active city-Boost eligibility; exclude target district by region-membership logic. Use weighted district sampling for large cities if needed; weights represent eligible member counts, not district-count uniformity.
- Surface-specific priority directories: district-scoped eligible Boosts and city-scoped eligible Boosts, correctly matched to the current viewer and target geography.
- Membership and active-entitlement changes propagate reliably via transaction/outbox and versioned projections; do not conflate a stale directory with permission to display stale private/blocked accounts. **Final authoritative eligibility check precedes response.**
- Time-expiry is validated against server time even if background expiry cleanup runs late. Allow signed-in account state and block changes to take effect immediately in final checks.
- Use PostgreSQL partitioning/indexes where measurements justify, avoid “one index per every combination” explosion, and keep high-churn updates off a single global hot row. If Redis is unavailable, no critical eligibility may depend solely on Redis.

### 5.1.1 Capacity proof and SPARSE_COMPLETE fast path at scale

For server-configured N, only need to distinguish `A_total < N` from `A_total >= N`, not calculate the full count of a million-person population. For bounded sparse pools, enumerate **all** authorized candidates from authoritative indexed sets and validate every account. For large pools prove `>= N` by finding N **distinct finally eligible** accounts; this proof must not be built from stale directory entries alone and must not overlook eligible accounts due to a bounded random sample. No exact full `COUNT(*)` is needed once sufficiency has been certified. If neither exhaustion nor sufficiency can be proven within bounded resources, return `UNCERTAIN_PARTIAL` (or a safe retryable error), never guess `SPARSE_COMPLETE`. Never use a known but unverified cached aggregate to claim a complete pool.

An important implementation detail: a product snapshot plus final privacy validation can shrink the selected set. The service must never respond with a false exhaustive claim when the final validity set differs; use bounded refill, authoritative re-evaluation, or mark uncertainty. Rate-limit adversarial workloads independently of sampling.

### 5.2 Exactness and quality gates

- **Bias:** A single static `random_key` with random pivot suffers gap-size inclusion bias and correlated neighbors. Rotating keys, multiple independent keys and pivot oversampling can reduce but **cannot prove** uniformity. Use dense directories / exact uniform alternatives or explicitly quantify measured deviation. Refresh random keys only if benchmarked; never rotate millions of rows in a single destructive transaction.
- **Eligibility:** For privacy/block correctness, serve from authoritative final checks. Do not send real IDs, emails, phone numbers, connection identifiers, private follow lists or hidden chat relationships in Shuffle response.
- **Bounded load:** Put hard upper limits on DB reads, candidate attempts and per-request work; time out safely as `UNCERTAIN`; report sampling underfill and latency. Request new random seeds for different batches. Do not issue giant `ORDER BY random()`/unbounded OFFSET over millions of rows.
- **Performance:** Target warm Shuffle p95 ≤250 ms under a *defined* load profile, p99 monitored and benchmarked, not guaranteed by writing a spec. Test with 1M+ registered accounts and realistic per-city skew, active users, blocks, Boost contention, cache and DB churn; protect correctness before latency. Engineer must publish measured p50/p95/p99, CPU, disk/IO, DB pool waits and drop/underfill rates before launch.
- **Isolation:** Reader availability/shard failures may reduce results with explicit `UNCERTAIN`, not leak forbidden candidates. No unbounded fan-out across all cities.

### 5.3 Scraping and enumeration controls WITHOUT viewer history

- Apply account, device attestation signal, session and IP/network-level request budgets for sample/refresh/profile fetch, plus adaptive anomaly controls; values must be load-tested and configurable in security admin settings. There must be no fixed anonymous discovery/paywall cap for normal users.
- Maintain short-lived **counts/tokens**, not lists of viewed profile IDs. Use Redis for distributed limits; on Redis/rate-limit infrastructure failure enforce a documented secure fallback with bounded local throttles / temporary unavailability for high-risk endpoints (avoid silently unlimited anonymous scraping).
- Add strong limits to autocomplete/username search and `/relationship-to-me` to mitigate following-label enumeration. The `follows_me` profile indicator is a **KNOWN, ACCEPTED PRIVACY LIMITATION**: individuals' following relationships can be inferred from repeated profile visits. Do not promise perfect follower anonymity.
- Return generic abuse responses as appropriate, instrument false-positive appeal/support path, avoid exposing detailed counter states to attackers. No public bulk profile export.
- Aggregate viewability statistics must exclude viewer IDs and require minimum-group thresholds for any admin breakdown in small geographies. Distinguish **returned**, **actually rendered/viewable**, **profile opened**, and **BOOST_BLOCK viewable** events. Aggregate without user→profile exposure histories.

## 6. API contract, typed clients, and response schema

**OpenAPI 3.1 is the single endpoint/schema source of truth.** The following names are intended canonical API *behavior* and schema examples; the generated OpenAPI document is authoritative when implemented. CI must fail if app/admin clients or spec examples drift. Do not independently hand-maintain divergent endpoint names.

`POST /v1/shuffle/sample` — authenticated, intentionally independently randomized draw. **The request MUST NOT include `shuffle_batch_size`, `batch_size`, `N`, `sparse_threshold`, `priority_ratio` or any override of server-side algorithms.** The server reads an immutable configuration version for the whole request, returns the applied batch size in the response, and does not choose different thresholds for different membership tiers.

**DISTRICT request (Standard or Plus):**

```json
{
  "mode": "DISTRICT",
  "target_district_id": null,
  "gender": "ALL"
}
```

**CITY request (Plus only):**

```json
{
  "mode": "CITY",
  "gender": "FEMALE"
}
```

- For Standard, `mode=DISTRICT` only; `target_district_id` may be absent/null, and the backend **always resolves its own home district**. Any explicitly supplied other district is rejected, not silently trusted.
- For Plus, district mode allows a valid district in account's home city. City mode ignores/rejects conflicting district value and resolves the account's home city. All `gender != ALL` modes require active Plus.
- API rejects any client attempt to supply `shuffle_batch_size` or other batch-size/threshold override, bad region, forbidden gender, suspended account and expired scope with typed localized **error codes**, not inline Turkish text.
- Response exposes only **opaque public user IDs**; never internal account database PKs or an anonymous sender's identity.

```json
{
  "batch_id": "nonidentifying_random_nonce",
  "mode": "DISTRICT",
  "applied": {"gender": "ALL", "shuffle_batch_size": 10, "district_id": "public_dist_id", "config_version": "cfg_opaque"},
  "selection_mode": "NORMAL",
  "completion": "FULL",
  "has_more": true,
  "items": [
    {"public_user_id": "usr_public_opaque", "presentation_rank": 0, "placement": "BOOST_BLOCK",
     "membership_tier": "STANDARD", "display_name": "...",
     "avatar": {"url": "short_lived_public_safe_url_or_null"},
     "home_city_label_key": "geo.city.istanbul",
     "home_district_label_key": "geo.district.esenyurt",
     "gender": "FEMALE", "card_badges": ["badge.promoted"]},
    {"public_user_id": "usr_other_opaque", "presentation_rank": 1, "placement": "DISCOVERY",
     "membership_tier": "PLUS", "display_name": "...", "avatar": null,
     "home_city_label_key": "geo.city.istanbul",
     "home_district_label_key": "geo.district.kadikoy",
     "gender": "MALE", "card_badges": ["badge.plus"]}
  ]
}
```

`batch_id` is a public render/request nonce, not a database-retained per-viewer sample log. Client uses `(batch_id,public_user_id)` for stable keys across independent appended batches; duplicate public IDs **within a batch** are invalid.

**`selection_mode` enum:** `NORMAL | SPARSE_COMPLETE | UNCERTAIN_PARTIAL`. `UNCERTAIN_PARTIAL` is not permission to claim the true pool was sparse; response must state `completion=UNCERTAIN`, and must never output a paid-priority block in excess of the safe NORMAL partial-response calculation.

**Do not return** `active_boost` status about other people in DISCOVERY cards, their Boost expiry, boost inventory counts, internal tier billing IDs, exact private social links, email or phone. The paid-priority badge is emitted only when `placement=BOOST_BLOCK`. Visible gender and general city/district fields reflect explicit product rules.

Related canonical product operations: home-region change is a separate authenticated profile action with a strict 30-day interval and active-Boost lock; Gold-wallet, Boost quote/activation and entitlement endpoints are defined in the dedicated wallet/billing OpenAPI section. Do not duplicate their paths in multiple Markdown specs. `shuffle` authorization must compute entitlements server-side, not accept client-paid flags.

## 7. UI/UX card system — premium without deceptive signals

### 7.1 Cards and list

- Full-width horizontal cards; height target **76–88 dp** at standard text scale, accessible expansion when needed; 52–58 dp circular profile photo; placeholder avatar when absent. Single vertical FlashList; precise spacing, no janky mounts; stable layout; dark/light themes and system dynamic type.
- Tap a card: open the public profile. NO in-card Like/Follow/Message buttons. Public profile manages social actions, and must separately respect anonymity rules from the security spec.
- **Standard + DISCOVERY:** elegant neutral card, high-quality typography, subtle divider/border.
- **Plus + DISCOVERY:** the same physical size, controlled gradient accent/animated frame, premium visual treatment **without suggesting real-identity verification**; Plus badge.
- **Standard + BOOST_BLOCK:** same size, paid-priority accent and localized `badge.promoted` label; no Plus claim.
- **Plus + BOOST_BLOCK:** combines premium identity and paid-priority indicator with restrained contrast; do not double badge or increase row height.
- **Active Boost + DISCOVERY:** **no promoted label**, same tier-specific Standard/Plus styling as if not boosted. Paid-placement disclosure depends on placement, not buyer status.
- If a card's Plus expires between fetching and opening, profile uses up-to-date entitlement and displays correct style; avoid leaking stale premium state for long periods.
- Animations are lightweight, respect Reduced Motion, do not animate every row continuously, and preserve high frame rate on midrange phones.
- Pull-to-refresh replaces current results; infinite scroll appends independent batches without session-wide deduplication. Prevent duplicate processing of the same network response, cancellation races, and out-of-order append after filter changes. Show explicit `completion` retry states.

### 7.2 Filters and product disclosure

- Filter sheet Standard: region display locked to home district; gender `Herkes` available, `Kadın` and `Erkek` visibly locked; tap opens Plus purchase screen; no backend-side unauthorized gender filter acceptance.
- Filter sheet Plus: city/district switch in its own city; chosen district; `Herkes/Kadın/Erkek` filter. Plus expiry resets effective gender filter to ALL and discovery mode to home DISTRICT.
- The 30-day home-region interval and active-Boost lock apply to **profile residence**, not Plus browsing between districts.
- Boost activation screen MUST display the **Gold cost**, current available Gold balance, fixed geographic scope, precise start/end/duration, that the entitlement survives Plus expiry until its own expiry, and **no guaranteed views/messages/impressions**. If balance is insufficient, direct user to buy Gold via the platform-compliant wallet top-up flow; NEVER launch an external payment directly for Boost. Distinguish Boost's paid-priority slots from Plus's premium design and wider discoverability.
- User-facing copy must not call an arbitrary paid top slot an algorithmic endorsement or claim that Boost owners make up exactly 30% of all displayed profiles.

## 8. Data model, transaction semantics and admin control

### 8.1 Domain entities (conceptual, not a second schema authority)

- `Account`: public opaque ID, membership status, home city/district, gender, discoverable flag, moderation state, home-region change timestamp.
- `PlusEntitlement`: authoritative validity window/status, including store server verification; no cached UI flag as security truth.
- `BoostEntitlement`: owner, immutable GOLD-funded scope class `DISTRICT` or `CITY`, **immutable purchased city/district target**, start/end timestamps, GOLD-debit ledger entry reference, immutable price snapshot, activation idempotency key and state. Plus expiry must NOT rewrite an active city Boost to district.
- `GoldWallet` / append-only `GoldLedger`: authoritative available balance and immutable credit/debit/transfer/reversal entries with unique operation keys; a single atomic transaction debits Gold AND activates Boost. No Redis balance authority or read-modify-write from client.
- `DiscoveryMembershipProjection`: pool memberships for discoverability, city/district, effective tier/Boost eligibility, key/directory references, version; **not** a per-viewer feed.
- `BlockRelation`: authoritative bilateral exclusion checks; no block enumeration by clients.
- `DiscoveryConfigVersion`: ratios, page sizes, rollout cohort, audit actor/time/reason, validation and rollback pointer.
- `AggregateMetric`: no viewer→profile links, minimum aggregation cohort threshold and retention limits.

### 8.2 Atomic and temporal behavior

- Home-region change and **Gold-funded Boost activation** acquire a consistent account-level lock / serialize their checks. If any Boost is active, region change is rejected; otherwise change home region and its discovery membership atomically. **Never transfer a Boost target.** Concurrent region changes cannot bypass the 30-day interval; concurrent Boost activation versus region change must not attach a Boost to an unintended place. Wallet debit, idempotency and one-active-Boost checks occur under database transaction isolation and account/wallet row locks.
- Plus expiry/revocation takes effect for filter and premium card checks immediately; valid city Boost remains as independently purchased right.
- Boost validity is time-window-checked **at sample time and final response validation**. Any Gold debit/reversal follows a separately audited ledger policy, not a silent reclassification workaround. Apple/Google store refunds concern **Gold top-ups**, not Boost activation; reconciled chargebacks must not create negative spendable Gold or unreviewed free Boosts.
- A user blocked between candidate draw and response must not appear after authoritative final check. Refills remain bounded; otherwise partial/UNCERTAIN.
- Subscription or gender status changes racing with selection cannot leave an unauthorized result; check the relevant authoritative states at finalization and test interleavings.

### 8.3 Admin panel

- Display editable `priority_slot_ratio_bps`, `district_local_ratio_bps`, supported server batch sizes and safe sampler budgets (within validated min/max); the 30-day home-region interval is fixed, not admin editable; show clear labels **priority slot share** and **target local/remote seat share**.
- Simulate examples for 10/15/20/25/35/50, local/remote scarcity, high Boost penetration and Plus-expiry city Boost; require confirmation, actor/reason audit log and rollback on production rule changes.
- Dashboard separates total selected cards, paid-priority slot allocations, actual viewable promoted placements, organic DISCOVERY views and Plus/Standard distribution; never report 30% as an exact Boost-holder share.
- Suppress low-cohort granular statistics and any output that would reconstruct who viewed a specific profile. Never show unapproved personally identifiable exposure trails.
- Enforce config schema validation, change permissions, optimistic versioning, feature-flag rollout and post-deployment monitoring. Some invariants (privacy, no history, no in-batch duplicates) are NOT admin-toggleable.

## 8.4 Home-region and immutable Boost policy — normative state machine

1. **Initial onboarding:** one self-declared `home_city_id` + `home_district_id` must be selected; persist `home_region_last_changed_at` as the single canonical timestamp. That selection is free but starts a strict interval of `30 * 24h` before any self-service change. Use UTC instants, not calendar-month approximations. User display is localized (for example “Next change on ...”).
2. **Home change eligibility:** at the serialized transaction decision instant `now`, `now >= home_region_last_changed_at + 30 days` **and** there is no active, valid, unexpired, not-reversed Boost entitlement owned by the account. An active purchase with even one second remaining blocks the change. The backend ignores client-supplied cooldown or tier hints.
3. **Scope:** city and district change together in one request; both remain within supported market/country. Merely changing district within same city counts as a full home change. Selecting the same city/district is a no-op and does not reset the 30-day timer.
4. **Error handling:** denied due to interval => stable `HOME_REGION_CHANGE_TOO_SOON` and next eligible timestamp; denied due to Boost => `HOME_REGION_LOCKED_BY_ACTIVE_BOOST` and latest active Boost end timestamp. Do not expose another user's home change status.
5. **Boost activation by Gold only:** user must already have Gold. The client obtains a server-priced, short-lived quote displaying **scope, target, duration, Gold price and quote expiry**. On explicit confirmation, the backend serializes home-region changes and wallet operations, checks quote/home version, Plus eligibility for CITY scope, available Gold and globally absent active Boost; atomically **debits Gold once** and creates one `ACTIVE` immutable Boost for the confirmed exact target. Failures, timeouts and replayed identical idempotency keys cannot double-debit or double-activate. No direct Apple/Google IAP exists for Boost. If the user bought Gold via an external store and later requests a refund, reconcile the Gold source with the audited ledger; do not misdescribe this as a Boost refund.
6. **Expiry and Plus:** an unexpired city Boost keeps remote city eligibility and CITY/DISTRICT paid-priority rights after Plus expiry; it NEVER unlocks Plus viewing/filtering/premium styling. After Boost expiry, effective scope returns to current membership rules. No automatic downgrade, up-scope or move of purchased Boost.
7. **Support exception:** fraud/error appeals can be reviewed, but no support operation may mutate a historical Boost's geographic target. If a real-world relocation must be handled before entitlement expiry, use a separately logged **Gold credit/reversal** with explicit eligibility and approval, or an approved replacement activation; never mint Gold invisibly, erase debit history or hide entitlement loss. Store refund rules apply only to the original Gold top-up transaction where relevant.
8. **One-active-Boost cap:** at most one `ACTIVE` Boost globally per account, regardless of DISTRICT/CITY scope. No future start, extension, queued Boost, concurrent stacking or second purchase while active. Expired, cancelled or reversed entitlements do not block new activation (subject to wallet and fraud controls). Activation occurs immediately after a successful atomic debit; expiry is authoritative server time.
9. **Abuse ceiling:** self-declared location remains inherently unverifiable without stronger verification. Enforce one active home region and 30-day interval, protect region changes against bot activity, and document that the geography is a user-declared preference, not a certified physical address.

## 8.5 Admin hard bounds and safe rollout

- `priority_slot_ratio_bps`: integer `500..4000`, default 3000; bounds apply to all create/update/import/rollback paths. **Cannot set 0, 5000, or 10000.**
- `district_local_ratio_bps`: integer `5000..9000`, default 7000; remote bps is derived as `10000 - local` and never writable separately. **Cannot set 0 or 10000.**
- Validate page sizes against exact allowlist `{10,15,20,25,35,50}`, with **10** default. Custom sizes require separate approved schema/version update; no arbitrary page size in production.
- Config changes are immutable-versioned, audited with actor/reason/diff, validated in simulation before activation, staged with rollback and consistency checks. Never enable a config that breaks `BOOST_NON_HARM`, exclusion privacy, or finite per-request query budgets.
- Report `BOOST_BLOCK` paid placements separately from total active Boost owner cards and observed viewability; no viewer-linked exposure histories.

## 8.6 Single-request allocator invariants and risk disclosure

- Fix eligible LOCAL/REMOTE populations and final total geographic seat allocation **before** inspecting Boost entitlements; seat backfill must use eligible capacity, not Boost owner counts. For non-Boost-eligible remote accounts, city Boost activation may also make them newly *eligible*; that is a separately tested membership expansion, not the fixed-membership monotonicity theorem.
- With fixed capacities and `n_L/n_R`, the §3.3 allocator has one deterministic output for any `(B_L,B_R)`: calculate bounded base split, fill initial allocations, then transfer any unused priority reservations to the stratum with actual available qualifying surplus (no reachable simultaneous dual-surplus tie-break). No stochastic priority transfer, mutable per-user weighting or ambiguous fallback order.
- In each stratum, priority selections are uniform without replacement among qualifying Boost owners; DISCOVERY selections are uniform without replacement among **all remaining** eligible accounts. Because the second draw can contain other Boost holders, actual Boost ownership in a batch can exceed reserved priority share.
- Per-request boost slots can round differently from percentage (for `Q=2`, locality target 70% produces 1/1). This is approved as an unavoidable small-integer effect and is included in reproducible unit tests.
- A Plus or Standard user's existing residence must never be presented as GPS verified. A remote Standard DISCOVERY card with a valid city Boost can reveal Boost status by inference; this is an accepted visibility side effect, **not** an authorization to emit billing records or Boost expiry metadata.
- Cross-batch duplicates and periodic priority blocks under infinite scroll are **accepted UX tradeoffs**. For an exactly exhausted small pool, `has_more=false`; refresh independently resamples. No client/session seen-history, no retroactive deduplication.

## 8.7 Gold-only Boost activation — canonical financial state machine

**CONFIRMED PRODUCT RULE:** A user does **not** pay cash or invoke Apple/Google in-app purchase while activating Boost. First, they acquire Gold in the wallet (purchased from the native store under applicable policies, awarded by promotion, transferred from another user or granted by administration). **All valid available Gold is fungible, transferable and spendable on Boost.** The account sees one spendable Gold balance. Immutable ledger provenance is retained internally for accounting, fraud/reversal investigations and support, not as a restriction on normal use. Gold gifting/transfer is covered by the wallet specification; Boost must work with credited Gold regardless of source.

**Allowed state transitions:** `NOT_PURCHASED -> QUOTE_ISSUED -> ACTIVE -> EXPIRED`; alternative `QUOTE_ISSUED -> REJECTED/EXPIRED_QUOTE`, `ACTIVE -> REVOKED` only through audited fraud/remediation and compensating Gold accounting where policy grants credit. No `QUEUED`, `SCHEDULED` or `EXTENDED` state in V5.2. Quotes are not entitlement reservations. Only a completed Gold debit creates an ACTIVE entitlement.

**Purchase journey (Expo UI):** user chooses an eligible Boost scope (Standard: registered-home DISTRICT only; active Plus: either registered-home DISTRICT or registered-home CITY; both choices shown clearly to Plus users), duration and package. Show destination city/district, **exact Gold price**, start/end and no guaranteed reach. User taps **Activate with X Gold**. If balance insufficient, go to separate **Buy Gold** wallet flow, wait for store-server-verified credit, then re-quote and confirm. Repeatedly pressing Activate while request is pending must not generate additional economic operations; return final success only on committed debit+Boost. Show transaction receipt in wallet and active-Boost screen.

**Atomicity/invariants:** Execute within one PostgreSQL transaction with consistent lock ordering `(account -> wallet -> entitlement)` and appropriate serializable/retry or explicit row locks: authenticate, verify account and quote validity and source-scope/home-version, lock account, check no active Boost, check available Gold, apply conditional wallet debit, insert immutable debit ledger entry, create `ACTIVE` Boost with `gold_ledger_debit_id`, commit, emit outbox event. If any step fails, **everything rolls back**. Use a unique operation key scoped to `(account, operation_type, idempotency_key)` with immutable payload fingerprint; one key cannot be reused for another package. The authoritative balance is never calculated from Redis or trusted from the client. A database-level exclusion/serialized invariant guarantees at most one active entitlement per owner even across distinct keys and concurrent devices. Ledger balances are verified by reconciliation; do not rely on a single mutable counter without an audit trail.

**Special failures:** `INSUFFICIENT_GOLD`, `BOOST_ALREADY_ACTIVE`, `BOOST_QUOTE_EXPIRED`, `BOOST_QUOTE_STALE_REGION`, `BOOST_SCOPE_REQUIRES_PLUS`, `BOOST_PRODUCT_UNAVAILABLE`, `BOOST_ACTIVATION_RETRYABLE`, `IDEMPOTENCY_PAYLOAD_MISMATCH`; localize from stable codes. On timeout the client polls/checks operation status by its key before creating a fresh attempt. A successful operation replay returns the identical economic outcome, not a second Boost.

**Gold provenance, refunds and reversals:** The original Apple/Google purchase is a **Gold top-up**, not a Boost purchase. Gold top-ups must be server-verified and exactly-once credited. The Gold debit used to activate Boost is non-store internal consumption of already credited wallet value. A store-approved refund/chargeback reverses or flags the associated Gold credit through **new audited ledger entries**, not deletion of wallet history; if Gold was already transferred or spent, never silently allow negative available balance or erase other users' lawful credits. Apply a documented risk/debt/freeze/manual review policy while preserving full accounting. Any goodwill cancellation of Boost and Gold credit is a separate audited compensating operation, not an automatic platform refund of Boost. Purchased Gold expiration and all transfer rules remain governed by the wallet/master spec and applicable store policy.

**Admin UI:** manage Boost packages and Gold prices as versioned immutable-at-purchase products; cap scope/duration, display effective dates, revoke with explicit reason/approval and reconciliation, reconcile gold debit <-> entitlement, alert on inconsistent balance or orphaned entitlement. No direct `UPDATE gold_balance` admin control. Changes to price do not retroactively alter an active Boost. No custom direct-purchase Boost gateway.

## 8.8 V5.2 operational lifecycle, compensation and catalog rules

**CONFIRMED entitlement lifecycle:** Boost is effective exactly while `starts_at <= server_now < ends_at` and its account remains eligible/visible on the surface. A lagging expiration worker **cannot** block a new purchase after `ends_at`. Enforce no intersecting non-revoked Boost intervals per owner at PostgreSQL level (e.g. GiST `tstzrange(starts_at,ends_at,'[)')` exclusion constraint with an appropriate predicate) plus the serialized account/wallet transaction; test exact-boundary restart. When activating, expire or reconcile stale state in that same transaction if needed. No future-start, overlapping, queued or automatically extended Boost. A Plus user may purchase home DISTRICT or home CITY; a Standard user may purchase home DISTRICT only.

**CONFIRMED no-pause policy:** User-hide/profile-offline makes profile ineligible, but Boost time continues; warn before hiding. Safety suspension makes the account ineligible, never bypassable by paid placement; Boost time continues during an upheld misconduct suspension. For an overturned erroneous moderation action, offer audited review/compensation consistent with published consumer terms; do not silently retarget a Boost. A platform-caused **material outage** (quantitatively defined below) enters a mandatory compensation review; approved proportional/full Gold credit is handled under the published policy. Compensation is a **new append-only ledger credit** with operator/reason/incident reference, not a mutation of original debit. No automatic extension of an already-ended region-bound Boost without a new authorized entitlement and compatibility checks.

**CONFIRMED material-outage trigger and Gold compensation review policy:** Treat an incident as material for the affected Boost purchase surface/region when **either** (a) three consecutive complete 5-minute UTC observation windows (≥15 continuous minutes) have a server-side discovery+paid-placement success rate **below 80%** of eligible attempts on that surface, with reliable instrumentation and a minimum of 100 eligible attempts per window; **or** (b) a verified total outage of the discovery/priority-placement capability on that surface lasts **≥15 consecutive minutes**, including low-traffic surfaces where the request-count threshold cannot be met. Scheduled maintenance qualifies if it meets the same disruption criteria; a user's isolated connection/device issue does not. The 5-minute windows, affected surface, active entitlement intersection, observability evidence, incident ID and recovery timestamp are retained in restricted operations telemetry. If insufficient monitoring exists to determine the threshold, open a mandatory manual incident review rather than automatically denying compensation. **Reaching the trigger obligates review, not an unconditional automatic payout**: compute affected Boost-time overlap with incident duration, propose `ceil(gold_price_paid * affected_eligible_minutes / purchased_duration_minutes)` Gold, bounded from 0 to the price paid, and approve or adjust with auditable reason under published terms and applicable consumer rights; never double-credit the same incident/entitlement. A full inability to deliver substantially all of the purchased interval should be reviewed for full credit. Credit through a new immutable ledger entry and idempotent `(incident_id, entitlement_id, compensation_type)` key; do not move the Boost target, rewrite its original price, or silently extend it. Admin may grant greater statutory/contractual relief where required. Aggregate signals do not contain per-viewer Shuffle exposure histories.

**CONFIRMED SPARSE paid-label semantics:** In SPARSE_COMPLETE, all *surface-qualifying* active Boost owners are sorted before DISCOVERY Plus/Standard and receive `placement=BOOST_BLOCK`, including when 100% of returned cards are Boost holders. **Keep the visible localized `badge.promoted` / “Öne Çıkan” label** in SPARSE_COMPLETE because the paid entitlement actually affects **rank** even if inclusion probability is 1. Never claim “30% of cards are sponsored” on such batches. Placement-specific labels remain mandatory; DISCOVERY never receives the promoted label, even if its owner holds an active Boost. This is a consciously accepted early-market UX/tradeoff, reflected in product copy and reported separately as `selection_mode=SPARSE_COMPLETE`; avoid misleading aggregate sponsored-share dashboards.

**Fraud/chargeback:** all Gold sources remain legally transferable/spendable in the product, but antifraud holds on suspicious funds/accounts may temporarily block transfers/Boost purchases. Verify store Gold top-ups server-side, prevent double credit, record provenance/transfer chains in privileged ledger, and do not leak identity in anonymous chat transfer history. Chargeback reconciliation must not drive wallet available balance below zero or silently claw back unrelated innocent users' credits; follow documented risk debt/hold/review policy with an auditable trail. No direct store purchase occurs at Boost activation.

**CONFIRMED viewer-dependent sparse-market disclosure — NEVER claim a single universal sparse status for a district/city:** SPARSE_COMPLETE is computed for each **actual viewer request** using that viewer’s account tier, selected discovery surface, gender filter, blocks and safety/visibility permissions. A seller's own district or a hypothetical unblocked Standard viewer is **not** a reliable proxy for all potential viewers. Therefore Boost catalog, quote and confirmation screens must use the **same always-visible, neutral localized disclosure** regardless of an estimated population: “Keşif sonuçları bakan kişinin üyeliğine, bölgesine, filtrelerine ve erişim kurallarına göre değişir. Bazı görüntülemelerde tüm uygun profiller zaten listelenebilir. Boost bu durumda yalnızca daha üst sırada yer almanı sağlar; görüntülenme garantisi vermez.” Provide equivalent i18n resources; do not compute or display a single `is_sparse_market` boolean on purchase quotes, and never show exact eligible audience sizes. The checkout must not promise an incremental inclusion gain, fixed impression count or fixed promoted-card fraction on every viewer surface. Back-end may expose a separately named, privacy-thresholded **advisory market-density estimate** for internal analytics only, never as a guarantee or client-facing claim.

**CONFIRMED Plus benefit:** Plus is NOT priority-slot placement. It *does* buy preferred relative positioning **after** eligible candidates have been drawn into ordinary DISCOVERY, so the Plus card is above Standard DISCOVERY cards. This has a real expected viewability advantage, distinct from inclusion probability. The purchase paywall and public product copy must say so explicitly; do not claim Plus offers only decoration/geographic reach.

**Administrative analytics:** every aggregate metric has a `selection_mode` dimension (`NORMAL`, `SPARSE_COMPLETE`, `UNCERTAIN_PARTIAL`). Analyze Boost priority-seat ratio by mode, never blend sparse cards into the NORMAL 30%-target KPI. Preserve minimum cohort thresholds; do not attach viewer IDs to viewability events or expose per-viewer impression trails.

## 9. Formal verification and required automated tests

### 9.1 Exact enumerator — compulsory release gate

For SMALL pools (e.g. 1–8 accounts per stratum), implement an **independent reference algorithm** that enumerates every possible priority subset and subsequent discovery subset and computes rational (or adequately precise high-accuracy) inclusion probabilities. Use it to test every membership arrangement and target user's before/after Boost toggle for fixed eligible membership.

In particular assert:

```text
P(selected | same population, target boosted) >=
P(selected | same population, target unboosted)
```

while holding target geography, all other accounts' Boost statuses, viewer, gender, blocks and config constant. Verify across district and city modes; for district mode, check both LOCAL and REMOTE separately, asymmetric Boost supply, priority-transfer between strata, scarcity, saturation, `Q=0`, `Q=N` and both strata underfilled.

The exact proof target applies to **qualifying Boost toggles without changing candidate eligibility**. Nonqualifying Boost purchases (district Boost in citywide discovery) must have **no priority impact** in that mode, and never reduce eligibility. New citywide discoverability after city Boost or Plus expiry changes candidate membership and is evaluated under a separately defined entitlement rule.

If a counterexample is found, **block release and revise the allocation**, do NOT weaken the assertion or hide it behind approximate statistical tests. Use mathematics/property-based testing, not only random smoke tests.

### 9.2 Mandatory functional and boundary cases

1. Standard own district allowed; other district and CITY rejected (including forged request).
2. Plus chooses any home-city district or citywide; other cities rejected.
3. Gender `ALL` Standard; `FEMALE`/`MALE` Plus; Plus expiry reverts filter to ALL.
4. Only registered `FEMALE/MALE` account states accepted; gender displayed and corrected only through controlled process.
5. District LOCAL includes local Standard and local Plus exactly once; REMOTE excludes local district entirely.
6. REMOTE includes active Plus OR active city Boost, including after Plus expires.
7. City Boost expiry removes remote reach if Plus is inactive; valid city Boost remains Boost-eligible in remote and DISCOVERY.
8. DISTRICT Boost only priority in its district; CITY Boost priority in any same-city district and CITY mode; district Boost is DISCOVERY-eligible citywide.
9. Local+remote total seat targets computed **across full N**, not separately per stage; local/remote shortage backfilled without duplicate.
10. Exact Q half-up: 10→3,15→5,20→6,25→8,35→11,50→15; no Python `round()`.
11. Local total half-up: 10→7,15→11,20→14,25→18,35→25,50→35.
12. Priority seat cross-stratum backfill constrained by n_s; local 1 Boost and remote many yields transferred priority while retaining local total count.
13. In NORMAL mode, Boost selected priority receives `BOOST_BLOCK` and badge only in the first Q (or fewer, if supply is lacking). In SPARSE_COMPLETE, ALL surface-qualifying Boost owners appear first with `BOOST_BLOCK`, even if this exceeds the normal ratio; every eligible profile is included.
14. Nonselected qualifying Boost participates in DISCOVERY; can appear there and receives **no promoted badge**.
15. Plus without Boost NEVER receives BOOST_BLOCK solely from tier, but receives CONFIRMED post-selection **preferred presentation rank ahead of DISCOVERY Standard** as well as premium appearance and geographic reach; selection probability remains unchanged solely from tier-order sorting.
16. No duplicate public ID within a batch; duplicates across independent batches permitted and not client-filtered.
17. Four eligible profiles with N=20 return exactly four, and `EXHAUSTED` only if exhaustion proven; new refresh may show same four.
18. Query-budget exhaustion produces `UNCERTAIN`, not `EXHAUSTED` or a false no-profiles message.
19. Full N-result batch may be followed by repeat results; `has_more` is **not** a fresh-profile promise.
20. Bilateral blocks, hidden profiles, moderation, suspended/deleted/self: excluded despite Boost.
21. Concurrent region changes: only one valid change; strict 30-day interval from initial home selection and last approved change; no double-region exposure.
22. Active CITY Boost survives Plus expiry with full scope, including **DISCOVERY** eligibility in remote district results; no fake Plus badge.
23. Active DISTRICT or CITY Boost blocks all self-service home-region changes; purchased Boost target, class, and expiry never change; no cross-city entitlement leakage.
24. Sampling fairness against exact baseline for dense, sparse, gender-skewed, blocked and churned populations; no starvation from random-key gaps.
25. Exhaustive Boost non-harm exact probability checks across all small-population permutations; property-based checks on larger pools.
26. Admin setting validation and audit; lower-cohort metric threshold; no viewer ID in viewability aggregates.
27. Basic scraping attempt triggers counters/rate response, without any saved viewed-user lists; no public bulk enumeration endpoint.
28. 1M+ registered accounts, diverse realistic city sizes, cold/hot traffic and changing entitlements; report measured p50/p95/p99 and DB CPU under load.
29. Pagination request after filter/home/Plus change must not append stale results from earlier filter generation.
30. Appends use batch-specific rendering keys; accepting duplicate IDs from different batches does not cause React key collision.
31. Paid placement remains semantically separate from active Boost owner status in API and all four visual card variants.
32. No other module (profile `Mesaja Git`, follow labels, notifications or chat) may infer anonymity from this discovery response; security model tested separately.

### 9.2.1 Additional mandatory V4.1 cases (still binding)

33. First onboarding home selection creates `home_region_last_changed_at`; no self-service home change at 29 days 23h 59m; exactly 30 full days permits it if no active Boost; same-region no-op does not reset clock.
34. Standard region swap request at day 6 is rejected even though its last home change was more than 6 hours ago; Plus district/city browsing remains unrestricted within home city and never modifies home.
35. A district Boost and a city Boost each individually block home-region change while active. On precise expiry and after 30-day interval, change succeeds; original Boost geography never mutates.
36. Race test: region change and purchase on the same account; exactly one coherent serialization order, no purchase attached to different geography than user confirmed, no region assignment mismatch, duplicate payments idempotent.
37. Plus expires mid CITY Boost: remote organic and priority eligibility persist to Boost expiry with Standard visual styling; expiry removes both reach and priority outside home district.
38. Admin rejects priority 0, 499, 4001, 5000, 10000 bps and locality 0, 4999, 9001, 10000 bps on create, patch, import and rollback.
39. The §3.3 allocator is deterministic for every capacity and Boost-count combination; the simultaneous dual-surplus tie-break is proven unreachable and not implemented; no geographic total seats change with Boost toggles.
40. Priority Q=2 with locality 7000 produces 1 LOCAL/1 REMOTE before scarcity; documentation never promises exact 70/30 on two indivisible seats.
41. Exhaustive Boost-toggle probability tests include all 0..8 small LOCAL/REMOTE capacities (prune infeasible combinations for runtime), all Boost statuses, the configured ratio boundaries and multiple supported N values; report proof domain and all exact arithmetic counterexamples.
42. No `badge.promoted` in `DISCOVERY`, even when a Standard remote account's geography makes its active city Boost inferable; API never sends `active_boost` or billing details to other viewers.
43. CITY mode response with absent district, district-mode Standard ignoring null/absent district, correct required location keys on all returned cards; validate examples against the generated OpenAPI contract.
44. Exactly 25 eligible accounts with `shuffle_batch_size=20`: repeated batches are allowed and may share cards; endpoint never asserts `has_more=false` solely because previous pages exist; when exact batch returns the whole pool, end autoload and keep explicit refresh.
45. Blocked/hidden/moderated users are never returned; deliberate scraper floods incur short-lived abuse counters without persistent viewer-profile exposure logs.

### 9.2.2 Prior V4.2 cases — Gold-funded Boost and population-mode boundary (server-size fixtures)

46. `N=20, exact A_total=8, qualifying B_total=6`: SPARSE_COMPLETE, 8 unique cards, six BOOST_BLOCK before both DISCOVERY classes; 30% cap does not apply; `has_more=false`.
47. For every exact `A_total=0..50` and supported `N`: if `A_total < N`, include all and sort Boost → Plus → Standard without ratio cap; otherwise NORMAL uses `Q=quota(N,ratio)` and at most Q paid-priority seats. Check all 500..4000 bps configured ratios.
48. Budget-limited sampler finds only eight of hundreds: MUST NOT infer `A_total=8`, must not turn on SPARSE_COMPLETE, and must not emit false EXHAUSTED; `UNCERTAIN_PARTIAL` must honor safe NORMAL placement and non-harm constraints or fail safely.
49. `home_region_last_changed_at` exists as **the only** canonical field, initialized during signup. Successful change updates once, same-region no-op and rejected change leave it unchanged.
50. Account with active DISTRICT Boost cannot activate CITY Boost and vice versa, even with enough Gold; no queue/stack/extension/future-start purchase. Expired historical Boost rows do not trigger active lock.
51. Insufficient Gold: `INSUFFICIENT_GOLD`, no ledger debit, no Boost, no partial state; UI offers Gold top-up separately.
52. Successful activation with 12 Gold balance and 5 Gold price: final balance 7, **exactly one** debit ledger entry of 5, exactly one ACTIVE entitlement at immutable confirmed region; no payment provider is invoked for Boost.
53. Concurrent double-tap, two devices, timeout/retry of same idempotency key: exactly one debit and one entitlement; identical retries return the original committed response; same key with different payload is rejected.
54. Concurrent independent activation keys with one affordable balance: at most one succeeds; no negative balance or multiple active boosts. Account lock, wallet lock and uniqueness constraints enforce this under load.
55. Gold transferred/gifted/promotional/stored-purchase sources are equally **spendable** for Boost and equally **transferable** in wallet flows; no hidden source-based lock. Wallet transaction conservation and audit check succeed.
56. User changes home between Gold quote and activation: quote rejected as `BOOST_QUOTE_STALE_REGION`, zero debit, zero entitlement; no implicit retarget. Concurrent region change versus activation serializes coherently.
57. CITY Boost activation requires active Plus at confirmation; already ACTIVE CITY Boost survives subsequent Plus expiry and remains eligible in district/city priority and remote DISCOVERY until expiry.
58. A charged-back/refunded Gold top-up is reconciled separately from Boost use; no ledger deletion, no negative spendable balance, no invisible credit mint or silent confiscation; unresolved debt/fraud is handled by a controlled reviewed policy.
59. Boost expires precisely at server time and releases region-change lock and one-active-Boost limit; rejected/failed activations do not reset home cooldown.
60. Admin Gold price version changes after quote expiry do not silently change agreed price; require re-quote. Invalid/disabled products fail without debit. Refund or grant requires audited compensating ledger entry, never SQL balance edits.
61. `Q=0` and `Q=N` remain unit-level mathematical boundary tests **independent of admin-approved production ratio bounds**; they are not permitted admin configurations.
62. No historical/live V4.0 migrations required for a greenfield rollout. If live data exists, produce a migration plan for former home timestamp aliases and previously transported Boost entitlements before deployment; do not guess targets.

### 9.3 Property-test pseudocode

```python
for population in generated_small_populations():
    for viewer_mode, target_gender, target_profile in valid_combinations(population):
        if target_profile in baseline_eligible_set:
            before = exact_inclusion_probability(population, target_profile)
            boosted_population = clone_with_qualifying_boost(population, target_profile)
            if same_eligible_membership(population, boosted_population):
                after = exact_inclusion_probability(boosted_population, target_profile)
                assert after >= before, build_counterexample_report(...)

    for sample in generated_samples(population):
        assert len(public_ids(sample)) == len(set(public_ids(sample)))
        assert all(eligible(user, viewer) for user in sample)
        assert placements(sample) == ['BOOST_BLOCK']*q_actual + ['DISCOVERY']*d_actual
        assert all(has_qualifying_boost(u) for u in priority_items(sample))
        assert all('badge.promoted' not in badges(u) for u in discovery_items(sample))
```

A separate model checker must verify no priority/geo quota violation under scarcity and no privacy breaches under concurrent block/expiry/region changes.

## 10. Implementation order, evidence and definition of done

1. Implement **immutable product rule tests** and exact reference sampler FIRST. Produce the exact probability/monotonicity report from §9. Fix any counterexample before production sampler implementation.
2. Implement entitlement and geography predicates with authoritative final checks, including city Boost preservation after Plus expiry.
3. Implement deterministic total geographic quota allocation and deterministic monotone priority allocation, then two unbiased candidate-selection stages.
4. Build/benchmark indexed sampling directories; compare output against reference distribution on test fixtures. Refuse approximate shortcuts that fail agreed fairness thresholds.
5. Generate OpenAPI 3.1 contract and typed Expo/Next.js clients; test all authorization and `completion` semantics.
6. Build premium FlashList UI with placement-based badges, correct filtering, no client-history dedupe and race-safe refresh/append.
7. Build secure admin settings/simulations and aggregate metrics; demonstrate privacy limits and no per-viewer history storage.
8. Run adversarial, financial-entitlement, race, load and mobile performance tests; record evidence/benchmark artifacts.

**SHUFFLE RELEASE BLOCKERS:** wrong SPARSE_COMPLETE triggering on candidate underfill; omitting an eligible Plus/Standard/Boost profile in a proven sparse pool; using a 30% or 70/30 cap to hide profiles in proven SPARSE_COMPLETE; sorting DISCOVERY Standard above DISCOVERY Plus; treating an irrelevant district Boost as CITY priority; Gold double spending, negative wallet balance, Boost activation without atomic debit, direct payment at Boost activation, simultaneous active entitlements, NORMAL quota applied to a proven sparse pool, or NORMAL-mode priority block exceeding its returned-batch cap; any leak of forbidden profiles; ability to bypass Standard/Plus restrictions; any in-batch duplicate; Boost non-harm counterexample under the stated fixed-population conditions; loss of purchased city Boost reach upon Plus expiry; wrong placement badges; unbounded DB scan on large pools; falsely claiming underfill is exhaustion; storing viewer history; missing basic abuse controls; or unmeasured performance against declared load targets.

**Do not silently modify this spec.** If the reference algorithm, proof obligations or real-load benchmarks expose a constraint that cannot simultaneously be met, document the precise minimal counterexample/tradeoff and request an explicit product decision before changing confirmed rules.

### 9.2.3 Additional V5.0-origin cases — exact adaptive population and paid-first / Plus-second / Standard-last

63. `N=10, A_total=8, B_surface=6, Plus_nonboost=1, Standard_nonboost=1`: return all eight; first six are qualifying Boost (internal random order), then Plus, then Standard; `has_more=false`, `selection_mode=SPARSE_COMPLETE`.
64. Same case with six Boost holders of mixed membership: Plus + Boost and Standard + Boost mix uniformly inside the first group; Plus tier does not override Boost-group order.
65. `N=10, A_total=8` where one remote Standard has an active CITY Boost surviving Plus expiry: it qualifies for remote reach and surface priority; remote Standard without city Boost is ineligible unless local. No duplicate candidates.
66. SPARSE_COMPLETE includes all Standard and Plus candidates even if LOCAL/REMOTE ratio would otherwise exclude some; excludes blocked/hidden/ineligible users regardless of total count.
67. SPARSE_COMPLETE with all eight Plus and no Boost: show all eight in randomized order with premium styling but no promoted badges.
68. SPARSE_COMPLETE with all eight Standard and no Boost: show all eight randomized, no premium or promoted badges.
69. SPARSE_COMPLETE citywide with a Standard user holding a DISTRICT Boost: the boost is nonqualifying in CITY mode; it does not get BOOST_BLOCK, appears in DISCOVERY_STANDARD after active Plus members.
70. `A_total=N` with all accounts eligible: NORMAL selection, every user included, Q paid-priority positions if enough qualifying Boosts, then Plus DISCOVERY then Standard DISCOVERY; do not accidentally enter sparse mode.
71. `A_total=N+1`: NORMAL selection of N distinct IDs, priority/geo quotas honored, allowed omissions according to exact inclusion probabilities.
72. NORMAL with `N=10, qualifying B=6, nonboost Plus=2, nonboost Standard=20`: 3 paid-priority positions; DISCOVERY may contain boosted holders (without promoted badge); all DISCOVERY Plus ordered above all DISCOVERY Standard; selection probabilities unchanged by this sort.
73. In NORMAL mode, two DISCOVERY Standard Boost holders and one DISCOVERY Plus nonboost: the Plus card appears before the Standard cards, even if the latter have active Boosts; placement, not owned entitlement, controls priority.
74. Across randomized property tests: for every returned batch, all BOOST_BLOCK cards form a prefix; among remaining DISCOVERY cards, all current Plus come before all Standard; random tie order within each block, no in-batch duplicate.
75. NORMAL district quotas account for selected users by LOCAL/REMOTE regardless of their display tier and reordered position; counts remain unchanged after Plus-first display sort.
76. A sampler finding eight through its budget while the real pool has 100 must report UNCERTAIN, not assert SPARSE_COMPLETE or EXHAUSTED; rate limit automatic retries.
77. At `A_total=0`, SPARSE_COMPLETE zero cards, empty state and `has_more=false`; refresh stays available.
78. With a valid small set then a new profile signs up while response is in flight: decide eligible population from one consistent snapshot and final security revalidation; if revalidation shrinks response, do not claim proven exhaustive coverage without a fresh proof.
79. Golden snapshot tests inspect the actual rendered visual order for Standard, Plus, Boost, Plus+Boost, Boost-in-DISCOVERY, expired Plus with city Boost, dark/light accessibility variants.
80. Customer/admin wording describes 30% as NORMAL reserved paid priority seats, explicitly excludes SPARSE_COMPLETE, and does not imply Boost ownership is secret or delivers guaranteed views.

81. Plus Boost catalog offers both home DISTRICT and home CITY scopes; Standard offers only home DISTRICT; Plus attempting Boost in a *browsed but non-home* district is denied; no restriction forces Plus to buy a CITY Boost.
82. Query/reply schema golden files include `selection_mode` and are validated against generated OpenAPI; `SPARSE_COMPLETE` must not arise from partial query budget.
83. Gold-funded Plus DISTRICT Boost activation remains atomic and eligible only on that home DISTRICT surface, not CITY priority; changing Plus browsing target does not change purchased Boost scope.

### 9.2.4 V5.1–V5.2 mandatory integration, adversarial and lifecycle cases (84–101)

84. With server `shuffle_batch_size=10`, POST supplies `page_size=50`; reject using a stable typed `SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE` error, never switch to sparse. Repeat with `batch_size`, `N`, `sparse_threshold`, and `priority_ratio` input; extra unknown inputs are forbidden by strict schema.
85. Server N=10, A_total=9: SPARSE_COMPLETE, all nine appear; N=10, A_total=10: NORMAL, exactly ten appear; N=10, A_total=11: NORMAL, ten sample. All use one snapshot config version.
86. For server N=10 and exactly eight eligible accounts (six surface-qualifying Boost, one Plus, one Standard), show all eight in `BOOST_BLOCK→DISCOVERY_PLUS→DISCOVERY_STANDARD` order; zero LOCAL/REMOTE quota enforcement; `has_more=false`.
87. With server N=10 and A_total=49, a POST containing `page_size=50` (or any client-size override) is **rejected** with `SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE`; no selection is executed. A subsequent valid request with no size field executes NORMAL and plans exactly ten slots. This must agree with test #84.
88. With server N=20 staging config, the legacy N=20 tests still pass; config switching is controlled, audited, pinned to one request, and never exposed as a client knob.
89. Every selected DISCOVERY Plus appears above every selected DISCOVERY Standard; selection probability reference enumerator remains unchanged when only presentation sorting runs. Plus marketing and test #15 acknowledge real *rank* advantage.
90. NORMAL district allocator proves only `A_L>=n_L0` / `A_R>=n_R0` if enough, or exact exhausted under-capacity when not; correctness matches exhaustive full-count reference without unbounded COUNT.
91. Sampling budget exhaustion does not report SPARSE_COMPLETE or EXHAUSTED; blocked-last-moment candidates do not leak; retry budgets finite.
92. With N=10 and `priority_slot_ratio_bps=3000`, Q=3 in NORMAL, even if 100 Boost owners exist; DISCOVERY may include Boost owners without promoted badge.
93. The exact same account in district vs CITY sample may be `BOOST_BLOCK` only on a surface covered by its purchased scope; unrelated district Boosts are not priority in CITY.
94. At exact Boost `ends_at`, new Boost purchase succeeds without waiting for background cleanup; direct overlapping interval attempts are rejected even with distinct idempotency keys.
95. Concurrent Boost purchase and home-region change serialize: Gold debited once only for the quoted immutable region or transaction safely rejected; no accidental relocation of purchased Boost.
96. A user hides profile while Boost is active: card disappears, timer continues, UI shows warning; unhide restores eligibility only for the unexpired remainder.
97. Moderation suspension excludes boosted profile; upheld vs overturned outcomes produce correct entitlement/compensation policy and audit log.
98. Material-outage test: 3 consecutive 5-minute windows with <80% eligible paid-placement success and ≥100 attempts per window trigger documented review; separately, ≥15 min of independently verified full outage triggers review even with low traffic. Affected Gold compensation is proportional to eligible time overlap, bounded, approved/audited, idempotent and append-only; below-threshold incidents do not auto-trigger, lack of monitoring triggers manual review. No original debit removal, duplicate credit or Boost retarget.
99. Store Gold top-up chargeback after multi-hop transfers triggers auditable debt/hold/review handling, no negative spendable balance, no unaudited third-party balance seizure and no duplicate ledger event.
100. Every Boost quote and confirmation (dense, sparse, uncertain) shows the same viewer-dependent neutral disclosure; fixture: one home district has 8 eligible profiles for a Standard viewer but a Plus CITY viewer has 400. No client `is_sparse_market` flag, exact population count, guaranteed incremental reach or viewer identity is exposed. UI copy matches approved i18n keys.
101. Aggregate admin reports group by `selection_mode`, separate selected from viewable and priority from tier, and enforce no viewer-ID exposure and low-cohort suppression. In a sparse fixture where all 9 profiles are Boost holders, all 9 display the paid placement label but NORMAL quota KPI remains unaffected; DISCOVERY badges remain absent.

### 9.4 Proof conditions for presentation and adaptive mode

- Sorting is a bijection of the selected cards; therefore it **cannot change inclusion probability**, local/remote membership counts, wallet balances, Boost scopes, or the placement assigned during selection. Prove using property tests over all permutations of reference outputs.
- `A_total<N` gives each eligible user inclusion probability **exactly 1**, with surface-qualifying Boost prefix, followed by active Plus and Standard. This does not prove identical visibility on-screen: upper cards have a positioning advantage.
- `A_total>=N` is the only region in which NORMAL Boost percentage/locality targets may exclude eligible candidates. Evaluate `BOOST_NON_HARM` only under its stated fixed-eligibility assumptions; ensure `A_total=N` case is explicitly covered.
- Security/moderation/blocks beat any placement right. If an eligibility change happens after a pool-size proof, revalidate and either safely repair from the consistent reference pool or mark UNCERTAIN. Never issue stale blocked identities.
- An eligible profile may own an active Boost **that is not qualifying on the current surface**. Such ownership is irrelevant to priority, and the profile is ordered by current Plus/Standard class like any DISCOVERY profile.

## 11. Revision history and final acceptance

| Version | Date | Change |
|---|---|---|
| 4.0 | 2026-11-13 | Boost non-harm framework, entitlement matrix, locality/priority quotas, selection stages, client behavior. |
| 4.1 | 2026-11-13 | Home-region interval **6h → 30 days**; disallow changes during active Boost; **remove Boost migration entirely**; immutable paid target; admin hard ratio bounds; deterministic two-stratum overflow order; explicit documented integer-seat rounding, accepted inference/UX tradeoffs, and 13 new tests. |
| 4.2 | **2026-11-13** | Priority slots use provable actual capacity M, eliminate unreachable tie-branch, one home timestamp, globally single immediate Boost, **Gold-only atomic Boost activation**, quote/idempotency/ledger safety, Greenfield migration note, and 17 added mandatory tests (#46–62). |
| **5.0** | **2026-11-13** | **Adaptive SPARSE_COMPLETE** displays every eligible profile when the proven eligible population is smaller than the effective batch size, with all qualifying Boost first; **NORMAL** selects using reserved priority seats and sorts `BOOST_BLOCK → DISCOVERY_PLUS → DISCOVERY_STANDARD` without skewing inclusion probabilities; 21 additional acceptance tests (#63–83). |
| **5.1** | **2026-11-13** | Server-controlled batch size and sparse threshold (default 10; client cannot manipulate); Plus paid ranking advantage explicitly recognized; NORMAL capacity proof optimized; Gold-funded Boost lifecycle/temporal exclusion, compensation, sparse purchase disclosure and mode-segmented analytics; tests #84–101. |
| **5.2 LOCKED** | **2026-11-13** | Viewer-dependent universal Boost checkout disclosure; consistent rejection of client page-size override; Q=N boundary notation; single server batch default 10; retain paid-placement labels in SPARSE_COMPLETE by explicit product decision; measurable outage trigger, review and idempotent proportional Gold compensation; updated tests #87, #98, #100, #101. |

**Decision status:** All listed product rules are **CONFIRMED** for Shuffle V5.2. No unresolved product choice blocks implementing its *specified behavior*. This is a design specification, **not evidence** of demonstrated mathematical fairness, unbiased large-scale sampling, uptime, or app-store compliance. The independently executed exact inclusion-probability checker, privacy/race/security tests, OpenAPI validation and scaled production-like load tests remain **mandatory release gates**. Do not claim empirical or formal verification has happened merely because tests are specified here.

**Precedence:** This V5.2 spec is the sole normative Shuffle domain document; older Shuffle sections in PRODUCT_SPEC and V3/V4 docs are historical and must not be used to implement Shuffle. In the unified master specification, use a single direct reference to V5.2 and derive endpoints and schemas from generated OpenAPI 3.1 rather than maintaining duplicate endpoint declarations.

