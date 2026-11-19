-- 0006: discovery directory maintenance (doc 11 §2, review H2).
-- Dense slot arrays per pool with swap-remove (no gaps → exactly uniform slot draws). The ONLY writer of
-- pool_slot is app.discovery_resync(account), and it is invoked by triggers on every authoritative table that
-- feeds a pool predicate — so no code path can forget it and the directory always mirrors authoritative state.

CREATE INDEX pool_slot_by_account ON app.pool_slot (account_id);

CREATE FUNCTION app.pool_for(p_city int, p_district int, p_gender app.gender, p_kind text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  SELECT id INTO v FROM app.pool WHERE city_id = p_city AND district_id = p_district AND gender = p_gender AND kind = p_kind;
  IF v IS NULL THEN
    INSERT INTO app.pool (city_id, district_id, gender, kind) VALUES (p_city, p_district, p_gender, p_kind)
      ON CONFLICT DO NOTHING RETURNING id INTO v;
    IF v IS NULL THEN
      SELECT id INTO v FROM app.pool WHERE city_id = p_city AND district_id = p_district AND gender = p_gender AND kind = p_kind;
    END IF;
    INSERT INTO app.pool_size (pool_id) VALUES (v) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v;
END $$;

-- add or refresh one membership (append at slot = size)
CREATE FUNCTION app.pool_put(p_pool bigint, p_account bigint, p_valid timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_size int;
BEGIN
  UPDATE app.pool_slot SET valid_until = p_valid WHERE pool_id = p_pool AND account_id = p_account;
  IF FOUND THEN RETURN; END IF;
  SELECT size INTO v_size FROM app.pool_size WHERE pool_id = p_pool FOR UPDATE;
  INSERT INTO app.pool_slot (pool_id, slot, account_id, valid_until) VALUES (p_pool, v_size, p_account, p_valid);
  UPDATE app.pool_size SET size = size + 1 WHERE pool_id = p_pool;
END $$;

-- remove one membership: the last slot moves into the hole, so slots stay dense 0..size-1
CREATE FUNCTION app.pool_remove(p_pool bigint, p_account bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_slot int; v_last int;
BEGIN
  SELECT size - 1 INTO v_last FROM app.pool_size WHERE pool_id = p_pool FOR UPDATE;
  DELETE FROM app.pool_slot WHERE pool_id = p_pool AND account_id = p_account RETURNING slot INTO v_slot;
  IF v_slot IS NULL THEN RETURN; END IF;
  IF v_slot <> v_last THEN
    UPDATE app.pool_slot SET slot = v_slot WHERE pool_id = p_pool AND slot = v_last;
  END IF;
  UPDATE app.pool_size SET size = size - 1 WHERE pool_id = p_pool;
END $$;

-- Recomputes ALL pool memberships of one account from authoritative tables, inside the caller's transaction.
-- Locks: account row first, then pool_size rows in ascending pool id (global lock order, doc 05 §4).
CREATE FUNCTION app.discovery_resync(p_acc bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  PERFORM 1 FROM app.account WHERE id = p_acc FOR UPDATE;
  FOR r IN
    WITH acc AS (
      SELECT home_city_id AS c, home_district_id AS d, gender AS g FROM app.account
       WHERE id = p_acc AND state = 'ACTIVE' AND discoverable AND NOT moderation_hold
         AND age_assured_at IS NOT NULL AND home_city_id IS NOT NULL),
    plus AS (
      SELECT max(COALESCE(grace_until, valid_until)) AS e FROM app.plus_entitlement
       WHERE account_id = p_acc AND state IN ('ACTIVE', 'GRACE') AND COALESCE(grace_until, valid_until) > now()),
    cb AS (
      SELECT max(ends_at) AS e FROM app.boost_entitlement
       WHERE owner_id = p_acc AND state = 'ACTIVE' AND scope = 'CITY' AND ends_at > now()),
    db AS (
      SELECT city_id, district_id, ends_at FROM app.boost_entitlement
       WHERE owner_id = p_acc AND state = 'ACTIVE' AND scope = 'DISTRICT' AND ends_at > now()),
    want AS (
      SELECT app.pool_for(acc.c, acc.d, acc.g, 'MEMBER') AS pool, NULL::timestamptz AS vu FROM acc
      UNION ALL
      SELECT app.pool_for(acc.c, acc.d, acc.g, 'REMOTE_ELIGIBLE'), GREATEST(plus.e, cb.e) FROM acc, plus, cb
       WHERE plus.e IS NOT NULL OR cb.e IS NOT NULL
      UNION ALL
      SELECT app.pool_for(db.city_id, db.district_id, acc.g, 'BOOST_DISTRICT'), db.ends_at FROM acc, db
      UNION ALL
      SELECT app.pool_for(acc.c, acc.d, acc.g, 'BOOST_CITY'), cb.e FROM acc, cb WHERE cb.e IS NOT NULL),
    cur AS (SELECT pool_id FROM app.pool_slot WHERE account_id = p_acc)
    SELECT COALESCE(w.pool, cur.pool_id) AS pid, w.pool IS NOT NULL AS wanted, w.vu
      FROM want w FULL JOIN cur ON cur.pool_id = w.pool
     ORDER BY 1
  LOOP
    IF r.wanted THEN PERFORM app.pool_put(r.pid, p_acc, r.vu);
    ELSE PERFORM app.pool_remove(r.pid, p_acc);
    END IF;
  END LOOP;
END $$;

-- ---------- every authoritative change re-syncs the directory ----------
CREATE FUNCTION app.trg_resync_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.discovery_resync(NEW.id); RETURN NULL; END $$;
CREATE TRIGGER account_discovery AFTER INSERT OR UPDATE OF state, discoverable, moderation_hold, age_assured_at,
  home_city_id, home_district_id, gender ON app.account FOR EACH ROW EXECUTE FUNCTION app.trg_resync_account();

CREATE FUNCTION app.trg_resync_plus() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.discovery_resync(NEW.account_id); RETURN NULL; END $$;
CREATE TRIGGER plus_discovery AFTER INSERT OR UPDATE ON app.plus_entitlement FOR EACH ROW EXECUTE FUNCTION app.trg_resync_plus();

CREATE FUNCTION app.trg_resync_boost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.discovery_resync(NEW.owner_id); RETURN NULL; END $$;
CREATE TRIGGER boost_discovery AFTER INSERT OR UPDATE ON app.boost_entitlement FOR EACH ROW EXECUTE FUNCTION app.trg_resync_boost();

-- Expiry cleanup (worker): correctness never depends on it (reads reject expired rows); it keeps X_s small.
-- A renewal racing the cleanup wins because resync recomputes from authoritative state under the account lock.
CREATE FUNCTION app.discovery_cleanup(p_limit int DEFAULT 1000) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT DISTINCT account_id FROM (
             SELECT account_id FROM app.pool_slot WHERE valid_until IS NOT NULL AND valid_until <= now() LIMIT p_limit) x
  LOOP
    PERFORM app.discovery_resync(r.account_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Drift check (review H2 mechanism 3): MEMBER pools vs. the authoritative predicate, and slot density.
-- Returns offending account ids (MEMBER drift) or pool ids (density drift, negated to tell them apart).
CREATE FUNCTION app.discovery_drift() RETURNS TABLE (ref bigint) LANGUAGE sql STABLE AS $$
  SELECT a.id FROM app.account a
   WHERE (a.state = 'ACTIVE' AND a.discoverable AND NOT a.moderation_hold AND a.age_assured_at IS NOT NULL AND a.home_city_id IS NOT NULL)
         IS DISTINCT FROM EXISTS (
           SELECT 1 FROM app.pool_slot s JOIN app.pool p ON p.id = s.pool_id
            WHERE s.account_id = a.id AND p.kind = 'MEMBER' AND p.city_id = a.home_city_id
              AND p.district_id = a.home_district_id AND p.gender = a.gender)
  UNION ALL
  SELECT -z.pool_id FROM app.pool_size z LEFT JOIN app.pool_slot s ON s.pool_id = z.pool_id
   GROUP BY z.pool_id, z.size HAVING count(s.slot) <> z.size OR COALESCE(max(s.slot), -1) <> z.size - 1
$$;

-- pre-create every pool for the seeded geography (pool_for also creates on demand)
SELECT app.pool_for(d.city_id, d.id, g.g, k.k)
  FROM app.district d, unnest(ARRAY['FEMALE', 'MALE']::app.gender[]) AS g(g),
       unnest(ARRAY['MEMBER', 'REMOTE_ELIGIBLE', 'BOOST_DISTRICT', 'BOOST_CITY']) AS k(k);

-- default discovery config, activated (admin changes create new versions; DB CHECKs bound every path)
INSERT INTO app.discovery_config_version (shuffle_batch_size, priority_bps, local_bps, created_by, reason, activated_at)
VALUES (10, 3000, 7000, 'migration', 'Appendix A defaults', now());
