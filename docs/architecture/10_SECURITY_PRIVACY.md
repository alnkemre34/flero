# 10 — Security & Privacy Model

**Inputs:** master §4–§11, A§5.3/§6/§8.6; the threat model produced by the `ecc:architect` security workstream (2026-11-14); the policy research by `research-analyst` (2026-11-14, partly UNVERIFIED). **Not legal advice.** Every compliance item is a launch gate for Turkish counsel.

## 1. Assets and adversaries

| Asset | Why it matters |
|---|---|
| A1 Anonymous initiator identity (before reveal) | Core product promise (REQ-ANON-01) |
| A2 Social graph privacy (follower identities, friend lists) | Owner-only data (REQ-SOC-03/05) |
| A3 Gold ledger and entitlements | Money-equivalent value, fraud target |
| A4 Chat content and media (incl. one-view) | Intimate data; CSAM/abuse risk |
| A5 Accounts and sessions | Takeover gives access to A1, A3, A4 |
| A6 Staff plane | Insider access to everything |
| A7 Discovery fairness (Shuffle, Boost) | Paid-placement integrity |

**Adversaries:** curious recipient B (multiple accounts, traffic inspection, a short suspect list), scraper/enumerator, spammer/harasser, fraudster (stolen cards, mule accounts), account-takeover attacker, malicious uploader, curious or compromised staff, and supply-chain compromise.

## 2. Anonymity architecture (ADR-016)
1. **Single projection.** `counterpartyView(viewer, conversation)` is the only resolver. Serializers are allowlists. In anonymous contexts the counterparty is `{kind: ANONYMOUS, label_key, avatar_style}` and nothing else (DEC-12: no gender/age/district of the anonymous sender).
2. **No client-side hiding.** The device of B never receives A's identity in any field, header, URL or cache.
3. **Random identifiers.** Conversation, message and media IDs are random, unrelated to user pairs. Storage keys are random UUIDs with no user path.
4. **Profile-state independence.** No profile, search, Shuffle, follow/like/block response or error B gets about any X may depend on whether X has an anonymous thread with B. This is verified by differential tests (§5).

## 3. Identity-oracle catalogue and mitigations

| # | Channel | Attack | Mitigation | Status |
|---|---|---|---|---|
| O1 | `Mesaja Git` on profile | B sees "go to existing chat" on A | CTA rule doc 08 §3.2 (never consults hidden threads) | Designed |
| O2 | Opposite-direction starts | B's message lands in A's hidden thread | Directional threads, consolidation after mutual identification | **DEC-01** |
| O3 | Block from anonymous thread | Bilateral suppression makes A vanish from B's search/Shuffle/following list; A's follow removal flips "Seni takip ediyor" on X and drops the count | **Anonymous-scoped shield block** (§3.1) | **DEC-02** (conflicts with CONFIRMED block rule) |
| O4 | Identified block of suspect X | If X = A, hidden thread closes instantly → confirmation | Hidden thread closure presented with the generic "Sohbet sona erdi" after a random 1–24 h delay; X's new messages held (not delivered) immediately. The residual inference is documented | **DEC-02b** |
| O5 | Mutual follow as test | B follows suspects; reveal fires for A | Authorized disclosure (CONFIRMED). Generic pre-follow disclosure to everyone; same post-mutual copy for every friendship | Accepted tradeoff |
| O6 | Follow/like timing | Count bump or notice coincides with anonymous message | Never group with message pushes; optional jitter | **DEC-16** |
| O7 | Presence/typing/receipts | Correlate thread activity with suspect's "online" | No user-visible presence anywhere (DEC-14). Typing only inside the thread. Receipts kept (CONFIRMED); low residual without public presence | Designed + DEC-14 |
| O8 | Gold transfers | Ledger/receipt/email shows sender | Projection renders "Anonim Kullanıcı"; reversal entries carry no counterpart; generic errors | Designed |
| O9 | Media | URL/EXIF/ICC/CDN logs; re-used avatar photo | Metadata stripped + re-encode; random keys; short-lived signed URLs; no viewer-sender joint CDN logs; warn A when sending a photo whose perceptual hash matches their own public avatar | Designed |
| O10 | Error codes | Different errors for blocked/deleted/hidden-thread states | `ACTION_UNAVAILABLE` for all; errors never depend on hidden state | Designed |
| O11 | Rate limits | Shared per-pair counters leak hidden activity | Keys by `(conversation, direction)` and by actor; generic 429 | Designed |
| O12 | Search | Personal boosting of counterparts; inbox search on hidden handles | No personalization; inbox search indexes text + viewer-visible label only | Designed |
| O13 | Push/OS integration | Lock screen, grouping, Siri/Spotlight, Android Person | doc 09 §4 | Designed |
| O14 | Deep links | Link resolves to profile | Opaque IDs, server re-authorization | Designed |
| O15 | Deletion/ban of A | Profile 404 at same moment thread ends | Generic "Sohbet sona erdi" with delay; profile disappearance is unavoidable | **DEC-15** (residual) |
| O16 | Report outcomes | "User banned" notice names the outcome | Generic delayed "Bildirimin incelendi" | **DEC-18** |
| O17 | Admin/support | Staff see or export mappings | §7 (break-glass) | Designed |
| O18 | Analytics/crash | Counterparty IDs in events or dumps | Event allowlist; warehouse pseudonyms with separate key; scrubbed crash reports | Designed |
| O19 | Anonymous sender attributes | Gender/age/district narrow suspects | Show none | **DEC-12** |
| O20 | KVKK data-subject export | B's export includes A's identity | B's export shows counterpart alias only (A's identity is A's personal data) | **DEC-19** |
| O21 | Cross-thread side effects of a shield block (review C2a) | B shields an anonymous thread, then watches whether X's identified thread breaks | Shield scoped to anonymous threads only (§3.1) | Designed |
| O22 | Pair-keyed velocity limits (gift, message) shared across anonymous and identified threads (review C2b) | B exhausts a shared limit via the identified thread and observes the effect in the anonymous one | Every per-pair counter keyed by `(conversation, direction)`; generic 429 | Designed |
| O23 | Reconstructing the identity mapping from other tables (review C1) | Staff or a compromised read role joins participant/message.sender_id/ledger/notification rows | Counterpart-bearing tables live in a restricted schema `ident` (no `admin_ro` grant); admin reads only alias-keyed views; CI test asserts that `admin_ro` cannot join any conversation to an account | Designed |

### 3.1 Shield block (proposal for DEC-02)
When B blocks from an anonymous thread, the server creates `block(kind='ANON_SHIELD', blocker=B, blocked=A)`:
- **A's side (scoped suppression):** the shielded thread closes for A with the generic ending. A cannot open a *new anonymous* thread to B, follow, like, or appear to B through any new action. **Scope limit (review C2a):** threads where B already knows A's identity are **not** affected. If they were, B would see "X can no longer reply or gift in our identified chat" and could confirm X = A. Gifts and replies in identified threads therefore keep working.
- **B's side (unchanged until identity is known):** B's search, Shuffle and following list don't change. A's existing follow of B is **frozen**: kept, but notification-silent and A can't act on it. It isn't deleted, because deleting it would flip the "Seni takip ediyor" label.
- **Upgrade:** if A's identity later becomes known to B (a mutual follow that B initiates while the frozen A→B edge exists, which the accepted O5 rule covers), the shield converts to a FULL block, with full CONFIRMED semantics.
- DEC-02 was approved on 2026-11-14.
- **A FULL block over a shield keeps it** (`shield_retained`), so a later unblock restores the shield instead of reopening anonymous contact (re-review New-2; migration 0002; model test).

### 3.2 Presented state during the DEC-02b delayed closure (re-review New-1)
When B fully blocks profile X and X holds a hidden anonymous thread T to B, the server applies the block immediately. **B's view of T is frozen as of the block instant until the delay passes** (random 1–24 h):
- `state` and `can_send` are unchanged.
- B's sends are accepted and stored, but never delivered to X.
- Receipts stay at their values at block time. This looks the same as an offline counterpart, which is common for anonymous requests.
- Push and typing from X stop. X can't send anything anyway.

At the end of the delay, T shows the generic "Sohbet sona erdi" ending.

**Residual (accepted):**
- B could notice that receipts never advance after the block. This is indistinguishable from an inactive anonymous sender.
- The shield-upgrade path (§3.1) reveals to B "X is the person I shielded", which is more than O5 alone discloses.
- A can infer the ending was a block from the frozen follow plus the UNAVAILABLE CTA.

These are recorded under RISK-03. **Model status (2026-11-14):** the delay is implemented in `packages/conversation-model` (`presentedCloseAt`, `observeInbox`). A differential test checks that B's inbox view of T is identical whether B blocked X (the hidden initiator) or an unrelated Y until the delay ends. It is mutation-checked: removing the delay fails it. **Backend obligation (M3.3):** replay the same sequences against the real API.

## 4. Account, session and authentication security (ADR-007)
- **Passwords:** argon2id (m = 64 MiB, t = 3, p = 1, calibrated to ≈ 100 ms on the API instance). Breached-password check (k-anonymity HIBP range API, which sends no user data). Minimum length 10.
- **Login protection:** per-account and per-IP progressive delays. Risk signals (new device, ASN reputation, impossible travel) → step-up via email OTP or phone (REQ-ONB-02). Generic error messages, no account enumeration on login, signup or reset.
- **OIDC:** verify the signature against JWKS, `iss`, `aud`, `exp`, `nonce`, and Apple `nonce_supported`. Handle Apple private-relay email and Apple's server-to-server revocation notifications. **No automatic merge on matching email.** Linking only from an authenticated session with re-authentication.
- **Tokens:** access JWT (EdDSA, 10 min, `kid` rotation). Refresh token: opaque, 256-bit, stored hashed, rotated on every use, 30-day sliding / 90-day absolute. Reuse of a used token revokes the whole family and alerts the user. Device binding: optional App Attest / Play Integrity attestation of the installation key at M8 (risk-based).
- **Email change:** confirm the old address, then the new one, then a 24 h cooldown before it can be used for reset, with a notification to the old address.
- **Mobile storage:** refresh token in Keychain (`afterFirstUnlockThisDeviceOnly`) / Android Keystore-backed EncryptedSharedPreferences via expo-secure-store. Encrypted SQLite cache key in the same store. No tokens in AsyncStorage or MMKV.
- **Age assurance [DEC-06]:** proposed layered approach: (1) self-declared date of birth at signup, used only to compute 18+ and then **discarded**, storing only `age_assured_at`, method and vendor reference (REQ-ONB-03); (2) platform age signals where available (Apple Declared Age Range, Google Play Age Signals); (3) risk-based escalation to a vendor check (document/face estimation) on reports or underage signals, retaining only the result. Exact vendor and legal sufficiency is DEC-06.

## 5. Privacy verification (gates)
1. **Differential oracle suite.** Pairs of worlds W0 and W1 that differ only in "X has an anonymous thread to B" (also: X revealed elsewhere, X shield-blocked, X deleted after delay). For each, capture B's full API surface (profile X, search, Shuffle cards containing X, follow/like/block responses and errors, inbox list minus the thread itself, notifications, wallet history, export) and assert equality after nonce normalization.
2. **Payload fuzzing.** Push composer and export generator fuzzed with anonymous contexts. Assert no counterpart public ID, handle, display name or avatar key.
3. **Forbidden-field contract tests** (doc 07 §4).
4. **Timing review.** Manual review of notification and presence timing correlations before launch (O6, O7).

## 6. Abuse, spam, scraping (A§5.3)
| Control | Mechanism |
|---|---|
| Rate limits | Valkey sliding windows per account / installation / IP and ASN / endpoint class (search, profile fetch, relationship, Shuffle, follow, like, message send, new threads per day, transfers). Values configurable in admin within validated bounds and load-tested. No fixed discovery cap for normal users |
| New-thread throttling | New anonymous threads per sender per day (proposed default 30; per hour 10) plus velocity scoring; text inside existing threads is unlimited except anti-flood (e.g. 30 msgs/min) |
| Content spam | URL/phone pattern detection in first messages of requests, reputation score, shadow-hold in requests for flagged senders (recipient still can see in a "filtered" subfolder) |
| Scraping | Opaque IDs; no bulk endpoints; per-day profile-view budgets; anomaly detection on `follows_me` probing patterns and follower-count sweeps; generic responses |
| Fallback | If Valkey is unavailable > 30 s: local in-process token buckets (stricter) for everyone. **Fail-closed** for Gold gifts and Boost activation (REQ-GLD-09), and for search, relationship probing and Shuffle **only for risk-flagged accounts/installations** (A§5.3). This is the canonical rule; docs 05, 11 and 17 refer to it |
| No viewer history | Counters only (counts/tokens with TTL), never ID lists (REQ-SEC-02) |

## 7. Staff plane (ADR-013)
- SSO + **WebAuthn mandatory** for all staff. Session 8 h, with re-auth for sensitive actions.
- RBAC with least privilege (role matrix in doc 15 §2). Support roles see conversation **aliases only**.
- **Break-glass de-anonymization:** requires the role `TS_INVESTIGATOR`, an open case ID, a reason code, step-up WebAuthn and a second approver (`TS_LEAD`, DB-enforced `approver ≠ requester`). The grant is **scoped to the conversation IDs named in the case** and time-boxed (2 h), executed via a security-definer function that writes `audit_event` in the same transaction, raises a real-time alert to the security channel, and is reviewed weekly.
- Exports are watermarked and PII-redacted by default, need dual approval, are logged, and expire after 7 days.
- No direct production SQL for humans. Emergency DB access goes through the break-glass IAM role with session recording **and pgaudit statement logging** shipped to WORM storage. Its use pages the security channel, because this path bypasses the in-transaction audit.
- Quarterly access reviews and immediate offboarding via SSO deprovisioning.

## 8. Media safety and CSAM
- Every upload lands in the quarantine prefix. The worker strips metadata, re-encodes, checks known-hash matching (vendor DEC-13, e.g. PhotoDNA, Google Content Safety, Thorn Safer) and runs classifiers (nudity/violence) **before** any delivery or preview generation.
- A positive CSAM hash: block, preserve evidence under legal hold in an isolated bucket, suspend the account, and report to the authorities per Turkish law and the vendor's reporting obligations (launch gate). Moderator tooling blurs by default.
- Report without paying Gold (REQ-MED-06): moderators see reported media through the review tool. The reporter does not unlock it.
- **[DEC-20]** One-view media is retained server-side for its 90-day retention for moderation, and the user is told so ("Tek görüntüleme, karşı tarafın tekrar açamaması anlamına gelir; güvenlik incelemesi için sunucuda saklama süresi boyunca tutulur").

## 9. Financial security (cross-ref doc 12)
- The ledger is append-only, the balance has a CHECK ≥ 0, wallet mutations go through a security-definer function, and nightly reconciliation alerts on any drift.
- **Chargeback laundering:** provenance lots, risk holds on newly purchased Gold before transfer (proposed: none by default; risk-scored hold up to 72 h for flagged purchases), velocity limits on 1-Gold transfers (per sender per hour/day, per pair, fan-in to a recipient), graph scoring of mule patterns. Debt on the purchaser, never confiscation of innocent recipients without a reviewed pattern (REQ-GLD-07).
- Fail-closed when the antifraud or DB dependency is unavailable.

## 10. Data protection and compliance (launch gates)

| Topic | Position (counsel to confirm) |
|---|---|
| KVKK cross-border (Law 7499, in force 01.06.2024) | Hosting in Frankfurt needs KVKK standard contracts with AWS (and processors: Sentry, Grafana, PostHog, moderation vendor), **notified to the Authority within 5 business days** of signing; no adequacy decision exists (per kvkk.gov.tr, checked 2026-11-14). DEC-07: EU hosting vs Turkish hosting |
| VERBİS registration, privacy notice (aydınlatma metni), explicit consent where required | Launch gate |
| Law 5651 social network provider duties (>1M daily access from Turkey: local representative, Turkish user data in Türkiye, takedown timelines) | Not triggered at launch; monitor daily active Turkish users; architecture keeps a portable data plane for localization (UNVERIFIED primary text) |
| Law 6493 (payment services/e-money) re transferable Gold | UNVERIFIED; transferable closed-loop currency with no redemption **likely** outside scope, but needs fintech counsel. DEC-08 |
| Consumer law 6502 (digital content withdrawal) | Pre-purchase acknowledgement; store refund channels; published refund policy (UNVERIFIED specifics) |
| Apple 3.1.1 | IAP currency must not expire → purchased Gold never expires (DEC-09); gifting allowed but non-exchangeable; no cash-out |
| Apple 1.2 "random or anonymous chat" | **Top launch risk (RISK-01).** Positioning: identity-bearing profiles, recipient always identified, initiator anonymity is limited and reveal-able, strong UGC controls (filter, report, block, timely response, published contact). DEC-21 |
| Apple 4.8 | Sign in with Apple offered alongside Google ✔ |
| Apple 5.1.1(v), Google account deletion | In-app deletion + web deletion URL ✔ |
| Google Play payments | Virtual currency sold via Play Billing; used only within the app ✔; transfers ambiguous → DEC-08 |
| Age 18+ | Store age rating 18+; age assurance DEC-06 |

**Data minimization:** no DOB, no ID images or biometrics retained; IP addresses kept 30 days in security logs (hashed beyond that for abuse aggregates); message bodies never in logs; analytics without counterpart IDs.

## 11. Platform and supply-chain security
- TLS 1.2+ everywhere, HSTS, certificate pinning **not** used (operational risk) but App Attest/Play Integrity considered for high-risk endpoints.
- Encryption at rest: RDS/S3/ElastiCache with KMS CMKs; per-purpose keys; key rotation yearly.
- CI: gitleaks, Semgrep (OWASP + custom rules for "no internal id in serializer", "no Math.random in shuffle-core"), OSV-Scanner/`pnpm audit`, license check, SBOM (CycloneDX), container scanning, Renovate with grouped updates; pinned GitHub Actions by SHA; OIDC to AWS (no long-lived keys).
- DAST: OWASP ZAP baseline on staging; external penetration test before launch (scope: auth, anonymity, wallet, admin).
- Incident response: severity matrix, on-call, runbooks (account takeover wave, ledger drift, CSAM detection, data leak, push leak), KVKK breach notification within **72 hours** to the Authority (launch gate to confirm), post-mortems.
