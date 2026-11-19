# 07 — API Architecture

**Style:** REST/JSON over HTTPS, OpenAPI 3.1 generated from Zod (ADR-003). Realtime: WebSocket events documented in AsyncAPI 3.0 (doc 08). The generated documents are authoritative once they exist (A§6). This file is the design plan, and the endpoint list below is **indicative**, not a second source of truth.

**Contract v0 status (M1.4, 2026-11-14).** `packages/contracts` holds the Zod source of truth. It generates `generated/openapi.v1.json` (OpenAPI 3.1, 19 operations) and `generated/asyncapi.v1.json` (AsyncAPI 3.0, 9 server and 5 client events). Redocly lints both documents with no errors or warnings. 32 tests cover:
- generator drift
- forbidden fields across every response schema and realtime event
- closed objects (`additionalProperties: false`)
- the anonymous counterparty shape (DEC-12)
- Shuffle override rejection (T84/T87) and response semantics (badges, ordering, duplicates, completion flags)
- the amount-less gift body
- the Idempotency-Key requirement

A planted sender-ID leak fails the forbidden-field test. **Update (same day):** the public v1 surface is complete, with **79 operations** covering auth, onboarding, me, geo, social, inbox actions, media upload/open/rendered, store/Plus/Boost catalog, banners and notifications. There are now 60 tests. New checks:
- self-only field allowances (`email` only in `Me`, `friend_count` only under `/v1/me`)
- every list is cursor-paginated or on an explicit bounded allowlist
- there is no unlike route
- friend endpoints are owner-only
- only `/v1/auth/*` is unauthenticated

The only remaining item in `COVERAGE_TODO` is the separate admin API document (M7). Where this doc and the generated documents disagree, the generated documents are authoritative.

## 1. Conventions

| Topic | Rule |
|---|---|
| Versioning | URL major version `/v1`. Additive changes only within a major. Every field removal or semantic change requires `/v2` or a negotiated capability. CI breaks on a non-additive OpenAPI diff (`oasdiff`) |
| IDs | Opaque public IDs only (`usr_`, `cnv_`, `msg_`, `med_`, `bst_`, `txn_`). Internal IDs never serialize. Response schemas are allowlists (`additionalProperties: false`) |
| Requests | Strict schemas reject unknown fields (`400 VALIDATION_FAILED` with `unknown_field`). This mechanism implements `SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE`: the Shuffle schema lists forbidden override names explicitly and maps them to that code (T84, T87) |
| Auth | `Authorization: Bearer <access JWT>` (10 min). Scopes derived server-side from session + account state. Staff tokens are never accepted on the public API |
| Idempotency | `Idempotency-Key` (UUIDv4) **required** on: message send, Gold transfer, unlock, purchase verify, Boost activation, region change, report. A replay with the same payload returns the original response. A different payload returns `409 IDEMPOTENCY_PAYLOAD_MISMATCH` |
| Pagination | Opaque cursors (HMAC-sealed, short-lived, containing only sort keys of *the viewer's own* data). **No cursor in Shuffle** (A§4) |
| Errors | RFC 9457 problem+json: `{type, code, status, title_key, detail_key, params, request_id}`. Stable `code` enum. Clients localize. **Anonymity rule:** errors for actions targeting a profile never depend on hidden-thread state. Blocked, suspended and deleted all map to the same `ACTION_UNAVAILABLE` (doc 10 oracle #10) |
| Rate limits | `429 RATE_LIMITED` with `Retry-After` only. Counter state is never exposed |
| Time | RFC 3339 UTC. Durations in seconds |
| Localization | `Accept-Language: tr` / `en`. Label keys (`geo.city.istanbul`) for reference data |

## 2. Resource map (v1, indicative)

**Auth & account**
- `POST /v1/auth/signup` (email/password) · `POST /v1/auth/login` · `POST /v1/auth/oidc/{google|apple}` · `POST /v1/auth/refresh` · `POST /v1/auth/logout` · `POST /v1/auth/password/reset-request` · `POST /v1/auth/password/reset` · `POST /v1/auth/email/verify`
- `GET /v1/me/sessions` · `DELETE /v1/me/sessions/{session_id}` · `POST /v1/me/sessions/revoke-all` (step-up)
- `POST /v1/me/providers/{provider}/link` (step-up) · `DELETE /v1/me/providers/{provider}`
- `POST /v1/onboarding/age-assurance` · `POST /v1/onboarding/consents` · `POST /v1/onboarding/home-region` (first selection only)
- `POST /v1/me/phone/verify-start|verify-confirm` (risk-triggered)
- `POST /v1/me/export` · `POST /v1/me/deletion` · `GET /v1/me/deletion`

**Profile & geo**
- `GET /v1/geo/cities` · `GET /v1/geo/cities/{id}/districts` (public cacheable)
- `GET /v1/me` · `PATCH /v1/me/profile` · `PUT /v1/me/home-region` (30-day + Boost lock → `HOME_REGION_CHANGE_TOO_SOON {next_eligible_at}`, `HOME_REGION_LOCKED_BY_ACTIVE_BOOST {boost_ends_at}`)
- `POST /v1/me/avatar/uploads` (→ presigned **POST policy** with `content-length-range` and content-type conditions, since a presigned PUT can't cap size, + upload_id; multipart for resume uses per-part size limits) · `POST /v1/me/avatar/uploads/{id}/complete {crop}` · `DELETE /v1/me/avatar`
- `GET /v1/profiles/{public_user_id}` → `{public_user_id, handle, display_name, avatar, gender, home_city_label_key, home_district_label_key, bio, follower_count, like_count, membership_tier_style, relationship: {i_follow, follows_me, i_liked, is_friend}, actions: {message: "OPEN_EXISTING"|"START_NEW"|"UNAVAILABLE"}}`
  - `actions.message` follows the rule in doc 08 §3.2. **`OPEN_EXISTING` appears only when the viewer already knows the counterpart's identity in that thread.**
  - `is_friend` describes only the viewer's own relation to X. It is derivable from `i_follow ∧ follows_me`, so it adds no information. Friend **lists and counts** of other users are never returned.
- `GET /v1/search/users?q=` (prefix ≥ 2 chars normalized, max 20 results, throttled, block-filtered; does **not** boost conversation counterparts)

**Social**
- `PUT /v1/follows/{public_user_id}` (idempotent) · `DELETE /v1/follows/{public_user_id}`
- `PUT /v1/likes/{public_user_id}` (idempotent, irreversible; **no DELETE route exists**)
- `GET /v1/me/following` · `GET /v1/me/friends` · `GET /v1/me/friends/count` (owner only)
- `PUT /v1/blocks/{public_user_id}` · `DELETE /v1/blocks/{public_user_id}` · `GET /v1/me/blocks`
- `POST /v1/conversations/{cid}/block` (block the counterpart **by conversation**, no user ID needed; REQ-ANON-05) · `POST /v1/reports {target: {type: PROFILE|CONVERSATION|MESSAGE|MEDIA, id}, reason, note}`

**Conversations**
- `POST /v1/conversations {recipient: public_user_id, first_message}` (starts a directional anonymous thread; Idempotency-Key)
- `GET /v1/inbox?filter=main|requests|archived&cursor=` · `GET /v1/inbox/search?q=` (searches message text and **the counterparty display label as seen by the viewer**, never hidden identities)
- `GET /v1/conversations/{cid}` (counterparty view projection, ADR-016) · `GET /v1/conversations/{cid}/messages?before_seq=&after_seq=&limit=`
- `POST /v1/conversations/{cid}/messages {client_msg_id, kind: TEXT, body}`
- `POST /v1/conversations/{cid}/accept` · `/reject` · `/archive` · `/unarchive` · `/mute {until}` · `/reveal` (initiator only, irreversible, confirmation token)
- `POST /v1/conversations/{cid}/receipts {delivered_seq?, read_seq?}` (monotonic)
- `GET /v1/sync?since_version=` → `{version, changed_conversations:[{cid, last_seq, delivered_seq, read_seq, state, ...}], full_resync_required}`

**Media**
- `POST /v1/conversations/{cid}/media/uploads {kind: PERSISTENT|ONE_VIEW}` → presigned PUT · `POST /v1/media/{mid}/complete` → message kind PHOTO posted when READY
- `GET /v1/media/{mid}` → `{state, kind, unlock_price_gold, expires_at, locked: bool, access?: {url, expires_in}}`. Sender always receives `access`
- `POST /v1/media/{mid}/unlock` (Idempotency-Key; debits Gold; persistent → access; one-view → UNOPENED)
- `POST /v1/media/{mid}/open` (one-view: lease + proxied stream URL) · `POST /v1/media/{mid}/rendered {lease_id}` (consumes)

**Wallet & billing**
- `GET /v1/wallet` → `{available, pending_hold_visible: bool}` · `GET /v1/wallet/transactions?cursor=` (counterparty rendered via the projection: "Anonim Kullanıcı" in anonymous threads)
- `GET /v1/store/products?platform=` · `POST /v1/wallet/purchases/verify {platform, signed_payload}`
- `POST /v1/conversations/{cid}/gold-gifts` (Idempotency-Key; body has **no amount field**, which is always 1)
- `GET /v1/plus/plans` · `POST /v1/plus/verify {platform, signed_payload}` · `GET /v1/me/plus`
- `GET /v1/boosts/catalog` (includes `disclosure_key` constant) · `POST /v1/boosts/quotes {package_id, scope}` (target is resolved from the home region server-side) · `POST /v1/boosts/activations {quote_id}` · `GET /v1/boosts/activations/{idempotency_key}` (status polling on timeout, A§8.7) · `GET /v1/me/boost`

**Discovery & home**
- `POST /v1/shuffle/sample {mode, target_district_id?, gender}`. Response exactly as A§6, plus `request_config_version`. Forbidden keys map to `SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE`.
- `GET /v1/home/banners?placement=` (frequency caps evaluated server-side by counters, not histories)

**Notifications**
- `PUT /v1/me/devices/{installation_id}/push-token {provider, token, locale}` · `DELETE …`
- `GET /v1/notifications?cursor=` · `POST /v1/notifications/read {up_to_id}` · `GET|PUT /v1/me/notification-preferences` (topics, quiet hours)

**Admin API** (`admin-api`, separate host, staff tokens; detail in doc 15): `/admin/v1/users`, `/reports`, `/cases`, `/investigations` (break-glass), `/media-review`, `/ledger/adjustments` (maker-checker), `/reconciliation`, `/catalog/{gold|plus|boost}`, `/shuffle-config` (+ `/simulate`), `/banners`, `/templates`, `/flags`, `/incidents`, `/compensation-reviews`, `/privacy-requests`, `/audit`.

## 3. Representative schemas

**Counterparty projection (anonymous thread, recipient view):**
```json
{ "conversation_id": "cnv_…", "state": "REQUEST",
  "counterparty": { "kind": "ANONYMOUS", "label_key": "chat.anonymous_user", "avatar_style": 3 },
  "my_role": "RECIPIENT", "can_reveal": false, "last_seq": 12, "read_seq": 12, "delivered_seq": 12 }
```
No `public_user_id`, gender, age, district, avatar URL or follow state for the counterparty (DEC-12 proposal). `avatar_style` is derived from a keyed HMAC of the conversation ID, never from the user.

**Initiator view of the same thread:** `"counterparty": {"kind":"IDENTIFIED","public_user_id":"usr_…", ...}, "my_role":"INITIATOR", "can_reveal": true`.

## 4. Contract test obligations (REQ-ANON-01, master §9)
1. **Forbidden-field tests:** for each endpoint × viewer role, the JSON Schema plus a deny-list scan (`id`, `account_id`, `email`, `phone`, internal numeric IDs, counterpart `public_user_id` in anonymous contexts, `active_boost`, `boost_ends_at` of others, `is_sparse_market`, audience counts).
2. **Differential oracle tests:** for viewer B and profile X, the responses from `GET /profiles/X`, search, Shuffle cards, follow/like/block error codes and `actions.message` are **byte-equivalent** (modulo nonces) between worlds where X has or hasn't an anonymous thread to B (doc 10 §5).
3. **Schemathesis fuzzing** against staging with seeded accounts. Every 5xx is a bug, and every response is validated against the schema.
4. **Shuffle golden files** validated against the generated OpenAPI (T43, T82).
