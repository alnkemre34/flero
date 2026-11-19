-- 0009: password reset, e-mail verification codes, notification preferences, notification deep links.

-- Reset tokens: 256-bit random, stored only as SHA-256, single use, 30-minute lifetime.
CREATE TABLE app.password_reset (
  token_hash  bytea PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES app.account,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_by_account ON app.password_reset (account_id, created_at DESC);

-- 6-digit e-mail codes: stored as a keyed hash, max 5 attempts, 15-minute lifetime; one live code per account.
CREATE TABLE app.email_code (
  account_id  bigint PRIMARY KEY REFERENCES app.account,
  code_hash   bytea NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Notification preferences (push only; the in-app centre always shows everything). Security and moderation
-- notifications cannot be disabled, so they have no column.
CREATE TABLE app.notification_prefs (
  account_id      bigint PRIMARY KEY REFERENCES app.account,
  messages        boolean NOT NULL DEFAULT true,
  requests        boolean NOT NULL DEFAULT true,
  social          boolean NOT NULL DEFAULT true,
  gifts_unlocks   boolean NOT NULL DEFAULT true,
  plus_boost      boolean NOT NULL DEFAULT true,
  wallet          boolean NOT NULL DEFAULT true,
  marketing       boolean NOT NULL DEFAULT false,      -- opt-in only (consent)
  message_preview boolean NOT NULL DEFAULT false,      -- off by default (doc 09 §4)
  quiet_start     text CHECK (quiet_start ~ '^\d{2}:\d{2}$'),
  quiet_end       text CHECK (quiet_end ~ '^\d{2}:\d{2}$'),
  quiet_tz        text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

-- A notification may deep-link to a conversation (opaque public id only; anonymity is kept by the copy).
ALTER TABLE ident.notification ADD COLUMN conversation_ref text CHECK (conversation_ref ~ '^cnv_[a-z2-7]{26}$');
UPDATE ident.notification SET conversation_ref = domain_ref WHERE event_type = 'MESSAGE_REQUEST' AND domain_ref ~ '^cnv_[a-z2-7]{26}$';
