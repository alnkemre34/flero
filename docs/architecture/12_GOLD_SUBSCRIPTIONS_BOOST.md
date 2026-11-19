# 12 — Gold Economy, Plus Subscriptions & Boost

Covers REQ-GLD-*, REQ-PLS-*, REQ-BST-*, REQ-MED-01…03/09/10, A§8.4–§8.8. Ledger model: ADR-010, doc 06 §6.

## 1. Ledger model
- **Double entry.** Every economic event is one `ledger_transaction` with ≥ 2 postings summing to 0.
- **Accounts:**
  - per user: `USER_AVAILABLE`, `USER_HELD`, `USER_DEBT`
  - system: `SYS_IAP_CLEARING`, `SYS_PROMO`, `SYS_ADMIN_GRANT`, `SYS_SUB_BONUS`, `SYS_SINK_UNLOCK`, `SYS_SINK_BOOST`, `SYS_COMPENSATION`, `SYS_CHARGEBACK_LOSS`
- **Balance projection:** `wallet.available`, `held` and `debt` are updated in the same transaction. They carry CHECK ≥ 0, so the database itself refuses a negative available balance (REQ-GLD-07).
- **Provenance:** postings carry `source_lot_id` (the purchase, promo, grant or bonus that created the Gold). Spending consumes lots FIFO for **accounting and fraud analysis only**. It never restricts what a user can spend (REQ-GLD-02, T55).
- **Gateway:** all mutations go through one function `wallet_apply(op)`, a security-definer SQL function called from the wallet module with strict operation types. The API role has no direct write grants (doc 06 §6).
- **Reconciliation:** a nightly job checks, for every wallet, `Σ postings(USER_AVAILABLE) = available` (same for held and debt), the global sum (= 0), and store clearing versus verified store transactions. Any drift is a SEV-2 alert that freezes the affected wallets' outgoing operations until resolved.

## 2. Operation catalogue
| Op | Postings (amounts in Gold) | Idempotency key | Pre-conditions |
|---|---|---|---|
| `IAP_CREDIT` | CLEARING −g → USER_AVAILABLE +g | `(store, store_txn_id)` unique | verified store transaction |
| `SUB_BONUS` | SYS_SUB_BONUS −b → AVAILABLE +b | `(store, renewal_txn_id)` | Plus renewal verified; amount from plan version (DEC-04) |
| `PROMO_CREDIT` / `ADMIN_GRANT` | SYS_PROMO or ADMIN −g → AVAILABLE +g | `(campaign_id, account)` / approval id | maker-checker approval for grants |
| `GOLD_GIFT` | **two transactions through a transit account** (re-review C1a), so that no single `app` row links sender and recipient: T1 (account = sender) sender AVAILABLE −1 → `SYS_GIFT_TRANSIT` +1; T2 (account = recipient) `SYS_GIFT_TRANSIT` −1 → recipient AVAILABLE +1. Both are committed in the same DB transaction. The T1↔T2↔conversation link lives only in `ident.gift_link` | `(sender, Idempotency-Key)` | both participants of the conversation; neither blocked or suspended; sender not frozen; velocity OK; **amount is a constant 1** (no field in the API) |
| `MEDIA_UNLOCK` | viewer AVAILABLE −p → SYS_SINK_UNLOCK +p **[DEC-03: sink]** (alternative: → sender AVAILABLE +p) | `(viewer, media_id)` unique (via `media_unlock` PK) | viewer is the recipient, not the sender; media READY and not expired; price = snapshot |
| `BOOST_DEBIT` | AVAILABLE −price → SYS_SINK_BOOST +price | `(account, BOOST_ACTIVATE, Idempotency-Key)` + quote_id unique | §5 |
| `HOLD` / `RELEASE` | AVAILABLE ↔ HELD | risk case id | risk engine or admin |
| `CHARGEBACK_REVERSAL` | see §3.3 | `(store, store_txn_id, 'REVERSAL')` | store notification |
| `COMPENSATION_CREDIT` | SYS_COMPENSATION −c → AVAILABLE +c | `(incident_id, entitlement_id, type)` | approved review (§6) |
| `ADMIN_ADJUSTMENT` | balanced, any accounts | approval id | maker-checker; reason; never pushes available below 0 |

**Gift UX contract (REQ-GLD-05):** a separate confirm sheet: "1 Gold gönder? Bakiye: X → X−1". One tap is one operation. There is no quantity picker, no long-press repeat, no bulk API. Double-tap protection: the button is disabled while in flight, and the same Idempotency-Key is reused for retries of that tap. A **new** tap after success is a new transfer, by design. Velocity limits (proposed defaults, admin-tunable):
- sender ≤ 20 gifts per hour and ≤ 100 per day (actor-scoped)
- **≤ 10 per hour per `(conversation, direction)`**, never per user pair. A pair counter shared between an anonymous and an identified thread would be an oracle (review C2b, doc 10 O22).
- a recipient fan-in anomaly score

All of these are evaluated server-side with generic `RATE_LIMITED`. Blocked, suspended or frozen accounts → `ACTION_UNAVAILABLE`.

**Anonymous thread rendering (REQ-GLD-08):** wallet history lines read "Anonim Kullanıcı'ya 1 Gold" or "Anonim Kullanıcı'dan 1 Gold", resolved through `counterpartyView` at read time. Because of that, a later reveal updates the label naturally. Emails and receipts carry no counterpart.

## 3. Store purchases (ADR-009)

### 3.1 Gold top-up (consumable)
1. The client starts the purchase (StoreKit 2 / Play Billing), using an `appAccountToken` (Apple requires a UUID: a UUIDv5-style value derived from an HMAC of the internal account ID) or an `obfuscatedAccountId` (Google, HMAC). The raw ID is never used. The server **verifies that the token matches the authenticated account** before crediting.
2. `POST /v1/wallet/purchases/verify`. The server verifies:
   - Apple: the JWS signature chain to the Apple root, bundle ID and environment, optionally confirmed with the App Store Server API.
   - Google: `purchases.products.get`, then checks `purchaseState`, `consumptionState` and that the account token matches.
3. `IAP_CREDIT` runs in one transaction: insert `store_transaction` (unique), ledger, wallet. Then respond 200.
4. Only after the 200 does the client `finish()` / `consume()`. If the app dies before that, the store re-delivers the transaction on next launch and verification is idempotent (returns the same result).
5. Server notifications (Apple V2 `REFUND`, `REVOKE`; Google voided purchases API polled daily + RTDN) trigger §3.3.

### 3.2 Plus subscription
- Products: monthly and yearly per platform. Prices are store-managed (DEC-04).
- Lifecycle source: Apple Server Notifications V2 (`SUBSCRIBED`, `DID_RENEW`, `DID_FAIL_TO_RENEW` with grace, `GRACE_PERIOD_EXPIRED`, `EXPIRED`, `REFUND`, `REVOKE`, `DID_CHANGE_RENEWAL_STATUS`) and Google RTDN (`SUBSCRIPTION_PURCHASED / RENEWED / IN_GRACE_PERIOD / ON_HOLD / CANCELED / EXPIRED / REVOKED`) plus `subscriptionsv2.get`. A periodic reconciliation poll (every 6 h for subscriptions changed in the last 7 days) catches missed webhooks.
- `plus_entitlement` keeps `valid_until` and `grace_until`. **Effective Plus** = `now < COALESCE(grace_until, valid_until)` and state ∈ {ACTIVE, GRACE}. Grace (billing retry) keeps Plus active, in line with store guidance. ON_HOLD / account hold → inactive.
- On each state change, in one transaction: **lock the account row first** (global lock order, doc 05 §4), update the entitlement, then call `discovery_resync` (doc 11 §2). The account lock serializes Plus revocation against CITY Boost activation, so a just-refunded user can't activate a CITY Boost in the race window (review H3). Plus-dependent views are recomputed per request anyway (filter reset to ALL, home DISTRICT view, styling; REQ-PLS-05).
- **Expiry never touches an active city Boost** (A§8.4.6, T22/T37/T57). The REMOTE_ELIGIBLE row keeps `valid_until = max(plus_end, city_boost_end)`.
- Refund of a subscription: entitlement revoked from the refund time. A Gold bonus already credited for that period is reversed via §3.3 rules (debt if spent). This policy must be disclosed (DEC-24).
- Cancellation = auto-renew off; Plus continues until `valid_until`. Upgrade/downgrade (monthly ↔ yearly) follows store semantics.

### 3.3 Refunds and chargebacks (REQ-GLD-04/07, T58, T99)
For a reversed top-up of `g` Gold:
1. Exact postings for one reversal transaction, balanced. Funds are consumed HELD-first, then AVAILABLE:
   - `h = min(g, held)`, `a = min(g − h, available)`, `d = g − h − a`
   - postings: `USER_HELD −h`, `USER_AVAILABLE −a`, `USER_DEBT −d`, `SYS_IAP_CLEARING +g`. These sum to `−h −a −d + g = 0`.
   - `USER_DEBT` is a **receivable**: its balance is ≤ 0, and `wallet.debt = −Σ postings(USER_DEBT)`, so the wallet's `debt` grows by `d`.
   - Available never goes negative.

   **Repayment:** each later credit `c` to a user with `debt > 0` posts `credit source −c`, `USER_DEBT +r`, `USER_AVAILABLE +(c−r)` with `r = min(c, debt)`. The sum is 0.

   **Write-off** (approved, after review) posts `USER_DEBT +d'` and `SYS_CHARGEBACK_LOSS −d'`, which moves the platform's loss out of the receivable. The sum is 0.

   *Correction (re-review M3, 2026-11-14): an earlier revision had postings summing to `d`, which the balance trigger would have rejected.*
2. While `debt > 0`, outgoing gifts and Boosts are blocked for the purchaser. Unlocks may also be blocked (configurable). Future credits repay the debt first. The UI explains this neutrally.
3. **Downstream recipients are not clawed back** automatically. Gold the purchaser already transferred stays with innocent recipients. If graph analysis flags a mule pattern, the involved accounts get a `HOLD` and a manual review case. Any later action is an audited, approved journal entry (REQ-GLD-07).
4. A Boost or unlock already consumed is not cancelled. The Boost was bought with Gold, not with the store payment (A§8.7).

## 4. Chat photo unlock (REQ-MED-*)
- The price is configurable per kind (persistent, one-view) in a versioned catalog (DEC-04) and snapshotted on the media row at send time.
- `POST /media/{mid}/unlock`, in one transaction: **first check for an existing `media_unlock (media_id, viewer)`. If found, return the existing entitlement with no charge and no balance check** (review H5). Otherwise lock wallet → check `available ≥ p` (else `INSUFFICIENT_GOLD`, offer top-up) → insert `media_unlock` (PK `(media_id, viewer)`; a conflict returns the existing unlock with **no charge**, REQ-MED-03) → `MEDIA_UNLOCK` postings.
- The sender is never charged and always gets access. A recipient can't route around the charge: there is no free endpoint, no preview derived from the pixels, and the server issues signed URLs only after an unlock.
- **Retention [DEC-05]:** before confirming, the unlock sheet shows "Bu fotoğraf {date} tarihine kadar görüntülenebilir" (media expires 90 days after send). The entitlement ends when the media expires, with no refund.
- **Moderation removal after unlock:** if DEC-03 is "credit the sender", this refund must also claw back the sender's credit (debt model). Otherwise it would mint Gold. If the photo is removed as prohibited content after the viewer paid, the viewer gets an automatic `COMPENSATION_CREDIT` refund of the unlock price (idempotent per media/viewer). This protects recipients from paying for abuse (master §6) without creating a free viewing route, since the content is then gone.
- One-view consumption protocol: doc 08 §8.

## 5. Boost

### 5.1 Catalog
Packages: `(package_id, version, scope ∈ {DISTRICT, CITY}, duration, price_gold, active_from, active_to)`. Versions are immutable once published, and a price change creates a new version (T60).
- Standard sees only DISTRICT packages.
- Plus sees both.
- The target is **always the registered home** (district, or city for CITY scope), never a browsed district (T81, T83).

Every catalog, quote and confirmation shows the same disclosure key, `boost.disclosure.viewer_dependent` (A§8.8, T100), plus "görüntülenme/mesaj garantisi yoktur". The client receives no `is_sparse_market` field and no audience size.

### 5.2 Quote
`POST /v1/boosts/quotes {package_id, scope}` creates a `boost_quote` row with: price snapshot, package version, scope, resolved target, `home_region_version`, `expires_at = now + 5 min`. The response contains exactly those values plus balance and the disclosure keys. The UI shows Gold cost, available balance, fixed target, exact start (now) and end, the duration, that the Boost outlives Plus expiry, and no guarantees (A§7.2). A quote is **not** a reservation (A§8.7).

### 5.3 Activation transaction (A§8.7, T50–T57, T94–T95)
```
BEGIN (READ COMMITTED + explicit locks; retry on serialization/deadlock ≤3)
  idem = SELECT … FROM ledger_transaction WHERE (account, 'BOOST_ACTIVATE', key)  → if exists: compare payload_hash → return original result / IDEMPOTENCY_PAYLOAD_MISMATCH
  SELECT … FROM account WHERE id=:me FOR UPDATE                     -- serializes with home-region change
  idem re-check here (review M1): a concurrent same-key request that committed while we waited returns its original result, not BOOST_ALREADY_ACTIVE
  SELECT … FROM wallet  WHERE account_id=:me FOR UPDATE
  quote := SELECT … FROM boost_quote WHERE id=:qid AND account_id=:me FOR UPDATE
  assert quote.consumed_at IS NULL                                   else BOOST_QUOTE_EXPIRED
  assert now() < quote.expires_at                                    else BOOST_QUOTE_EXPIRED
  assert account.home_region_version = quote.home_region_version     else BOOST_QUOTE_STALE_REGION
  assert package version still purchasable                           else BOOST_PRODUCT_UNAVAILABLE
  assert scope=CITY ⇒ effective Plus(now)                            else BOOST_SCOPE_REQUIRES_PLUS
  assert NOT EXISTS active boost (state<>'REVOKED' AND now()<ends_at) else BOOST_ALREADY_ACTIVE
  assert wallet.debt = 0 AND not frozen                              else ACTION_UNAVAILABLE (risk)
  assert wallet.available ≥ quote.price                              else INSUFFICIENT_GOLD
  txn := wallet_apply(BOOST_DEBIT, price, key, payload_hash)
  INSERT boost_entitlement(starts_at=now(), ends_at=now()+duration, …, gold_ledger_debit_id=txn, quote_id)   -- GiST exclusion is the backstop
  UPDATE boost_quote SET consumed_at=now()
  pool inserts: BOOST_DISTRICT or BOOST_CITY slot (+ REMOTE_ELIGIBLE valid_until=max(…) for CITY)
  INSERT outbox(boost.activated)
COMMIT
```
- **Atomicity:** any failure rolls back everything, so there is no debit without a Boost and no Boost without a debit (REQ-BST-04).
- **Double-tap / two devices / timeout:** same key → original result. Different keys → the account lock serializes them, and the second request sees the active Boost → `BOOST_ALREADY_ACTIVE` with zero debit (T53, T54).
- **Timeout on the client:** poll `GET /v1/boosts/activations/{key}` before trying again (A§8.7). On a network error the UI shows "İşlem kontrol ediliyor", never a second charge.
- **Exact boundary:** at `now() = ends_at` the old Boost no longer intersects (`[)`), so a new activation succeeds without waiting for cleanup (T59, T94).

### 5.4 Home-region change (A§8.4, T21, T33–T36, T49)
`PUT /v1/me/home-region {city_id, district_id}`, in one transaction:
1. Lock the account.
2. Same region → no-op, timer unchanged (T49).
3. `now() < last_changed + interval '30 days'` → `HOME_REGION_CHANGE_TOO_SOON {next_eligible_at}`.
4. Any Boost with `state <> 'REVOKED' AND now() < ends_at` → `HOME_REGION_LOCKED_BY_ACTIVE_BOOST {boost_ends_at}`.
5. Otherwise update the home, `home_region_last_changed_at = now()` and `home_region_version + 1`, move the MEMBER (and REMOTE_ELIGIBLE) pool slots, and write a history row.

Because the account row lock is shared with Boost activation, any interleaving serializes into exactly one coherent order (T36, T95). Rejected attempts change nothing.

### 5.5 Lifecycle without pause (A§8.8)
- Validity is purely `starts_at ≤ now < ends_at` and `state <> 'REVOKED'`.
- Hiding the profile or a suspension makes the account ineligible while the timer keeps running. The UI warns before hiding (T96).
- An upheld suspension gets no compensation. An overturned suspension opens a review case (§6) (T97).
- `REVOKED` only through an audited fraud/remediation path with approval, and always together with the compensating ledger accounting the policy grants.
- Support can never edit the target, scope, times or price. A DB trigger rejects UPDATE of those columns.

## 6. Material-outage compensation (A§8.8, T98)
- **Telemetry:** per surface (city × district × mode), 5-minute UTC windows: eligible attempts, successful discovery+paid-placement responses (HTTP 200 with a valid NORMAL/SPARSE result and the priority stage executed), and capability-down flags from synthetic probes (one per active surface class every minute). Retained 400 days in restricted ops storage, aggregate only.
- **Trigger detector** (worker, every 5 min):
  - (a) 3 consecutive complete windows with success rate < 80 % and ≥ 100 eligible attempts in each window; or
  - (b) a verified total outage ≥ 15 consecutive minutes (synthetic probe failure plus incident confirmation).
  - Missing telemetry for a window → open a manual review automatically.
- **Review case:** affected entitlements = active Boosts whose scope covers the surface, intersected with the incident interval. Proposal: `ceil(price × affected_eligible_minutes / purchased_minutes)`, clamped to [0, price]. An approver accepts or adjusts with a reason, and the credit is `COMPENSATION_CREDIT` keyed `(incident_id, entitlement_id, 'OUTAGE')`, so it can never be paid twice. There is no extension and no retargeting. Below-threshold incidents trigger nothing automatically. Admin may grant more where law requires.

## 7. Failure behavior
| Dependency down | Wallet/Boost/unlock/gift behavior |
|---|---|
| PostgreSQL primary | All economic operations fail with `503 *_RETRYABLE`; nothing is partially applied |
| Valkey (rate limits / velocity) | **Fail closed** for gifts and Boost: `TEMPORARILY_UNAVAILABLE` (REQ-GLD-09). Unlock allowed (no transfer risk) with DB-side per-account limits |
| Store APIs | Verification returns retryable; the client keeps the unfinished transaction |
| Antifraud scorer | Gifts and Boost fail closed; top-up credits proceed (verified by the store) but can be risk-held |

## 8. Owner decisions in this domain
DEC-03 unlock Gold destination · DEC-04 prices and catalogs (Gold packs, unlock prices, Boost packages, Plus prices, subscription bonus) · DEC-05 unlock vs retention · DEC-08 transfer legality and store interpretation · DEC-09 Gold expiry (recommend: purchased Gold never expires, as Apple 3.1.1 requires; promo Gold may expire only with disclosure) · DEC-23 RevenueCat vs direct · DEC-24 subscription-refund bonus reversal policy.
