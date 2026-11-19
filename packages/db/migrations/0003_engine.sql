-- 0003: engine foundations — versioned price catalogs (DEC-04: owner-managed in admin), idempotency records,
-- staff identities + approvals, geo seed, and the single ledger gateway app.post_ledger().

-- ---------- versioned catalogs (immutable rows; a change = a new version) ----------
CREATE TABLE app.gold_product (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store         text NOT NULL CHECK (store IN ('APPLE', 'GOOGLE')),
  product_id    text NOT NULL,                       -- store SKU (price itself is set in the store console)
  version       int NOT NULL,
  gold_amount   int NOT NULL CHECK (gold_amount BETWEEN 1 AND 1000000),
  active        boolean NOT NULL DEFAULT true,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store, product_id, version)
);
CREATE TABLE app.unlock_price (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('PERSISTENT', 'ONE_VIEW')),
  version     int NOT NULL,
  price_gold  int NOT NULL CHECK (price_gold BETWEEN 1 AND 10000),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);
CREATE TABLE app.boost_package (
  package_id   int NOT NULL,
  version      int NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('DISTRICT', 'CITY')),
  duration     interval NOT NULL CHECK (duration BETWEEN interval '15 minutes' AND interval '30 days'),
  price_gold   int NOT NULL CHECK (price_gold BETWEEN 1 AND 100000),
  active       boolean NOT NULL DEFAULT true,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (package_id, version)
);
CREATE TABLE app.plus_plan (
  plan_id     text NOT NULL,
  version     int NOT NULL,
  period      text NOT NULL CHECK (period IN ('MONTHLY', 'YEARLY')),
  store       text NOT NULL CHECK (store IN ('APPLE', 'GOOGLE')),
  product_id  text NOT NULL,
  bonus_gold  int NOT NULL DEFAULT 0 CHECK (bonus_gold BETWEEN 0 AND 100000),
  active      boolean NOT NULL DEFAULT true,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, version)
);
-- catalog rows are append-only: price history must never be rewritten (A§8.7 "immutable at purchase")
CREATE FUNCTION app.catalog_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'catalog rows are append-only' USING ERRCODE = 'insufficient_privilege'; END IF;
  -- only the active flag may change (to retire a version)
  IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
    RAISE EXCEPTION 'catalog rows are immutable; create a new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gold_product_guard BEFORE UPDATE OR DELETE ON app.gold_product FOR EACH ROW EXECUTE FUNCTION app.catalog_guard();
CREATE TRIGGER unlock_price_guard BEFORE UPDATE OR DELETE ON app.unlock_price FOR EACH ROW EXECUTE FUNCTION app.catalog_guard();
CREATE TRIGGER boost_package_guard BEFORE UPDATE OR DELETE ON app.boost_package FOR EACH ROW EXECUTE FUNCTION app.catalog_guard();
CREATE TRIGGER plus_plan_guard BEFORE UPDATE OR DELETE ON app.plus_plan FOR EACH ROW EXECUTE FUNCTION app.catalog_guard();

-- ---------- request idempotency (generic; ledger ops are additionally unique in ledger_transaction) ----------
CREATE TABLE app.idempotency_record (
  account_id    bigint NOT NULL REFERENCES app.account,
  operation     text NOT NULL,
  key           uuid NOT NULL,
  payload_hash  bytea NOT NULL,
  status        int NOT NULL,
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, operation, key)
);
CREATE INDEX idempotency_ttl ON app.idempotency_record (created_at);

-- ---------- staff plane (ADR-013) ----------
CREATE TABLE app.staff_user (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,          -- dev/stage only; production uses SSO + WebAuthn (integration stub)
  roles         text[] NOT NULL CHECK (roles <@ ARRAY['SUPERADMIN','SUPPORT_L1','SUPPORT_L2','MODERATOR','SENIOR_MODERATOR',
                  'TS_INVESTIGATOR','TS_LEAD','FINANCE_VIEWER','FINANCE_OPERATOR','FINANCE_APPROVER','GROWTH',
                  'PRODUCT_CONFIG_EDITOR','PRODUCT_CONFIG_APPROVER','SRE','PRIVACY_OFFICER','AUDITOR']::text[]),
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.approval (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL,           -- e.g. LEDGER_ADJUSTMENT, SHUFFLE_CONFIG, CATALOG_CHANGE
  payload       jsonb NOT NULL,
  requested_by  bigint NOT NULL REFERENCES app.staff_user,
  reason        text NOT NULL CHECK (char_length(reason) >= 5),
  approved_by   bigint REFERENCES app.staff_user,
  decided_at    timestamptz,
  decision      text CHECK (decision IN ('APPROVED', 'REJECTED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)          -- four eyes, DB-enforced
);

-- ---------- geo seed (launch markets; labels are i18n keys) ----------
INSERT INTO app.city (id, label_key) VALUES
  (34, 'geo.city.istanbul'), (6, 'geo.city.ankara'), (35, 'geo.city.izmir')
ON CONFLICT DO NOTHING;
INSERT INTO app.district (id, city_id, label_key) VALUES
  (3401, 34, 'geo.district.kadikoy'), (3402, 34, 'geo.district.besiktas'), (3403, 34, 'geo.district.uskudar'),
  (3404, 34, 'geo.district.sisli'), (3405, 34, 'geo.district.esenyurt'), (3406, 34, 'geo.district.beyoglu'),
  (3407, 34, 'geo.district.atasehir'), (3408, 34, 'geo.district.bakirkoy'),
  (601, 6, 'geo.district.cankaya'), (602, 6, 'geo.district.kecioren'), (603, 6, 'geo.district.yenimahalle'),
  (3501, 35, 'geo.district.konak'), (3502, 35, 'geo.district.karsiyaka'), (3503, 35, 'geo.district.bornova')
ON CONFLICT DO NOTHING;

-- ---------- system ledger accounts ----------
INSERT INTO app.ledger_account (kind) VALUES
  ('SYS_IAP_CLEARING'), ('SYS_PROMO'), ('SYS_ADMIN_GRANT'), ('SYS_SUB_BONUS'), ('SYS_SINK_UNLOCK'),
  ('SYS_SINK_BOOST'), ('SYS_COMPENSATION'), ('SYS_CHARGEBACK_LOSS'), ('SYS_GIFT_TRANSIT')
ON CONFLICT DO NOTHING;

-- ---------- the single ledger gateway (ADR-010, doc 12 §1) ----------
-- postings: [{"account": "USER_AVAILABLE"|"USER_HELD"|"USER_DEBT"|"SYS_*", "owner": <account id or null>, "amount": <int>}]
-- Balanced by the deferred trigger; wallet projection updated in the same statement set; available >= 0 enforced
-- by CHECK (raises 23514 → API maps to INSUFFICIENT_GOLD). Idempotent on (account, op_type, key).
CREATE FUNCTION app.post_ledger(p_op text, p_account bigint, p_key text, p_hash bytea, p_actor text, p_reason text, p_postings jsonb)
RETURNS TABLE (txn_id bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
DECLARE
  v_txn bigint; v_existing record; p jsonb; v_acc bigint; v_kind text; v_owner bigint; v_amt bigint;
BEGIN
  SELECT id, payload_hash INTO v_existing FROM ledger_transaction
   WHERE account_id IS NOT DISTINCT FROM p_account AND op_type = p_op AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_existing.payload_hash <> p_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH' USING ERRCODE = 'P0409';
    END IF;
    RETURN QUERY SELECT v_existing.id, true; RETURN;
  END IF;

  INSERT INTO ledger_transaction (op_type, account_id, idempotency_key, payload_hash, actor, reason)
  VALUES (p_op, p_account, p_key, p_hash, p_actor, p_reason) RETURNING id INTO v_txn;

  FOR p IN SELECT * FROM jsonb_array_elements(p_postings) LOOP
    v_kind := p->>'account'; v_owner := NULLIF(p->>'owner', '')::bigint; v_amt := (p->>'amount')::bigint;
    IF v_kind LIKE 'USER\_%' THEN
      INSERT INTO ledger_account (kind, owner_id) VALUES (v_kind, v_owner)
        ON CONFLICT (kind, owner_id) WHERE owner_id IS NOT NULL DO NOTHING;
      SELECT id INTO v_acc FROM ledger_account WHERE kind = v_kind AND owner_id = v_owner;
      INSERT INTO wallet (account_id) VALUES (v_owner) ON CONFLICT DO NOTHING;
      UPDATE wallet SET
        available = available + CASE WHEN v_kind = 'USER_AVAILABLE' THEN v_amt ELSE 0 END,
        held      = held      + CASE WHEN v_kind = 'USER_HELD' THEN v_amt ELSE 0 END,
        debt      = debt      - CASE WHEN v_kind = 'USER_DEBT' THEN v_amt ELSE 0 END,   -- receivable: debt = -Σ
        version   = version + 1
      WHERE account_id = v_owner;
    ELSE
      SELECT id INTO v_acc FROM ledger_account WHERE kind = v_kind AND owner_id IS NULL;
    END IF;
    IF v_acc IS NULL THEN RAISE EXCEPTION 'unknown ledger account %', v_kind; END IF;
    INSERT INTO ledger_posting (txn_id, ledger_account_id, amount) VALUES (v_txn, v_acc, v_amt);
  END LOOP;

  RETURN QUERY SELECT v_txn, false;
END $$;
REVOKE ALL ON FUNCTION app.post_ledger(text, bigint, text, bytea, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.post_ledger(text, bigint, text, bytea, text, text, jsonb) TO api_rw, worker_rw;

GRANT SELECT ON app.gold_product, app.unlock_price, app.boost_package, app.plus_plan TO api_rw, worker_rw;
GRANT SELECT, INSERT, DELETE ON app.idempotency_record TO api_rw, worker_rw;

-- ---------- onboarding order: home region is chosen AFTER signup (signup → age → consent → region) ----------
ALTER TABLE app.account
  ALTER COLUMN home_city_id DROP NOT NULL,
  ALTER COLUMN home_district_id DROP NOT NULL,
  ALTER COLUMN home_region_last_changed_at DROP NOT NULL,
  ADD CONSTRAINT home_region_all_or_none CHECK (
    (home_city_id IS NULL) = (home_district_id IS NULL) AND (home_city_id IS NULL) = (home_region_last_changed_at IS NULL));
