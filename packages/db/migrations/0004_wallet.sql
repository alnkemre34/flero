-- 0004: wallet engine support — opaque public ids for ledger transactions and Boost entitlements.

-- 128+ random bits → 26 base32 chars; never derived from internal ids (REQ-ID-01).
CREATE FUNCTION app.opaque_id(prefix text) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := 'abcdefghijklmnopqrstuvwxyz234567';
  b bytea := public.gen_random_bytes(26);   -- pgcrypto (0001); callers may run with a narrow search_path
  out text := prefix || '_';
BEGIN
  FOR i IN 0..25 LOOP
    out := out || substr(alphabet, (get_byte(b, i) & 31) + 1, 1);
  END LOOP;
  RETURN out;
END $$;

ALTER TABLE app.ledger_transaction ADD COLUMN public_id text NOT NULL UNIQUE DEFAULT app.opaque_id('txn');
ALTER TABLE app.boost_entitlement  ADD COLUMN public_id text NOT NULL UNIQUE DEFAULT app.opaque_id('bst');

-- wallet history reads postings of one user account newest-first
CREATE INDEX ledger_posting_history ON app.ledger_posting (ledger_account_id, txn_id DESC);
-- "my active boost" and the home-region lock look up by owner + time
CREATE INDEX boost_entitlement_owner ON app.boost_entitlement (owner_id, ends_at DESC) WHERE state = 'ACTIVE';
