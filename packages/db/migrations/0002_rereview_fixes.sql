-- 0002: fixes from the M1.8 independent re-review (docs/architecture/21 §"Re-review").
-- Forward-only; 0001 is never edited.

-- (C1b) The shield's frozen follow edge is derived from ident.block at read time; a flag on app.follow
-- would itself encode "A was B's anonymous initiator" outside the ident schema.
ALTER TABLE app.follow DROP COLUMN frozen;

-- (New-2) A FULL block must not silently erase an earlier shield: keep it and restore it on unblock.
ALTER TABLE ident.block ADD COLUMN shield_retained boolean NOT NULL DEFAULT false;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'ident.block'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%origin_conversation_id%'
  LOOP
    EXECUTE format('ALTER TABLE ident.block DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE ident.block
  ADD CONSTRAINT block_shield_origin CHECK ((kind = 'ANON_SHIELD' OR shield_retained) = (origin_conversation_id IS NOT NULL)),
  ADD CONSTRAINT block_shield_retained_only_on_full CHECK (NOT shield_retained OR kind = 'FULL');

-- (C1d) Alias key is no longer a session setting admin_ro could choose; it lives in a schema admin_ro
-- cannot read, and the alias includes a side discriminator.
CREATE SCHEMA admin_secret;
REVOKE ALL ON SCHEMA admin_secret FROM PUBLIC;
CREATE TABLE admin_secret.alias_key (id boolean PRIMARY KEY DEFAULT true CHECK (id), k bytea NOT NULL);
INSERT INTO admin_secret.alias_key (k) VALUES (gen_random_bytes(32));

-- Inlined (not a function): PostgreSQL checks function EXECUTE against the caller even inside a view,
-- while table access inside a view uses the owner's privileges — so the key stays unreadable.
CREATE OR REPLACE VIEW admin_v.conversation_alias AS
SELECT encode(hmac(convert_to('conversation:' || c.id::text, 'UTF8'), (SELECT k FROM admin_secret.alias_key), 'sha256'), 'hex') AS alias,
       c.state, c.created_at, c.last_message_at, (c.initiator_revealed_at IS NOT NULL) AS revealed
FROM ident.conversation c;

-- (C1a) Gifts are posted through a transit account; the sender↔recipient↔conversation link lives only here.
ALTER TABLE app.ledger_account DROP CONSTRAINT ledger_account_kind_check;
ALTER TABLE app.ledger_account ADD CONSTRAINT ledger_account_kind_check CHECK (kind IN (
  'USER_AVAILABLE', 'USER_HELD', 'USER_DEBT',
  'SYS_IAP_CLEARING', 'SYS_PROMO', 'SYS_ADMIN_GRANT', 'SYS_SUB_BONUS',
  'SYS_SINK_UNLOCK', 'SYS_SINK_BOOST', 'SYS_COMPENSATION', 'SYS_CHARGEBACK_LOSS', 'SYS_GIFT_TRANSIT'));
CREATE TABLE ident.gift_link (
  sender_txn_id    bigint PRIMARY KEY REFERENCES app.ledger_transaction,
  recipient_txn_id bigint NOT NULL UNIQUE REFERENCES app.ledger_transaction,
  conversation_id  bigint NOT NULL REFERENCES ident.conversation,
  CHECK (sender_txn_id <> recipient_txn_id)
);

-- (C1c) Audit rows about anonymous contexts (reveal, shield, break-glass) are kept out of app.audit_event.
CREATE TABLE ident.audit_event_sensitive (LIKE app.audit_event INCLUDING ALL);
CREATE TRIGGER audit_sensitive_append_only BEFORE UPDATE OR DELETE ON ident.audit_event_sensitive
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- (New-5) System-account transactions (account_id NULL) must also be idempotent.
CREATE UNIQUE INDEX ledger_transaction_system_idem
  ON app.ledger_transaction (op_type, idempotency_key) WHERE account_id IS NULL;

-- (New-5) Columns/tables named in doc 06 but missing from 0001.
ALTER TABLE ident.media_object ADD COLUMN sha256 bytea, ADD COLUMN phash bytea;
ALTER TABLE app.store_transaction ADD COLUMN raw_jws_ref text;
CREATE TABLE ident.push_attempt (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id    bigint NOT NULL REFERENCES app.account,
  event_type      text NOT NULL,
  domain_ref      text NOT NULL,
  provider        text NOT NULL CHECK (provider IN ('apns', 'fcm')),
  status          text NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'TOKEN_INVALID', 'GAVE_UP')),
  provider_status text,
  attempts        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, event_type, domain_ref)        -- dedupe (doc 09 §1)
);

-- grants for the new objects
GRANT SELECT, INSERT, UPDATE ON ident.gift_link, ident.push_attempt TO api_rw, worker_rw;
GRANT SELECT, INSERT ON ident.audit_event_sensitive TO api_rw, worker_rw;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA ident TO api_rw, worker_rw;

-- (New-5) Tighten: likes are irreversible and messages are immutable (edits are DEC-11, not approved).
REVOKE UPDATE ON app.like_edge FROM api_rw, worker_rw;
REVOKE UPDATE ON ident.message FROM api_rw, worker_rw;
GRANT DELETE ON ident.message TO worker_rw;              -- retention job only (REQ-MSG-15)
