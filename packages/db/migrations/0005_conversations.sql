-- 0005: conversation engine support — DEC-02b delayed presentation, withheld sends, reports, search/inbox indexes.

-- DEC-02b: a recipient who fully blocks a still-hidden initiator keeps the pre-block presentation for a random
-- 1–24 h. The thread is CLOSED server-side at once; the recipient's sends during the delay are stored (withheld)
-- and never delivered, and they never move the initiator-visible watermark.
ALTER TABLE ident.conversation
  ADD COLUMN presented_close_at     timestamptz,
  ADD COLUMN presented_state_before ident.conv_state,
  ADD COLUMN withheld_count         int NOT NULL DEFAULT 0 CHECK (withheld_count >= 0),
  ADD CONSTRAINT presented_pair CHECK ((presented_close_at IS NULL) = (presented_state_before IS NULL));
ALTER TABLE ident.message ADD COLUMN withheld boolean NOT NULL DEFAULT false;

-- inbox: newest activity first
CREATE INDEX conversation_activity ON ident.conversation (last_message_at DESC NULLS LAST, id DESC);
-- handle prefix search (handle_norm is already normalised)
CREATE INDEX account_handle_prefix ON app.account (handle_norm text_pattern_ops);

-- Reports stay in ident: a report on an anonymous thread links reporter ↔ conversation (review C1).
CREATE TABLE ident.report (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         text NOT NULL UNIQUE DEFAULT app.opaque_id('rpt'),
  reporter_id       bigint NOT NULL REFERENCES app.account,
  target_type       text NOT NULL CHECK (target_type IN ('PROFILE', 'CONVERSATION', 'MESSAGE', 'MEDIA')),
  target_account_id bigint REFERENCES app.account,     -- resolved server-side; never sent by the client
  conversation_id   bigint REFERENCES ident.conversation,
  target_ref        text NOT NULL,                     -- the opaque public id the reporter saw
  reason            text NOT NULL CHECK (reason IN ('SPAM', 'HARASSMENT', 'NUDITY', 'MINOR_SAFETY', 'VIOLENCE', 'IMPERSONATION', 'OTHER')),
  note              text CHECK (char_length(note) <= 1000),
  priority          smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),   -- 0 = MINOR_SAFETY fast lane
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'ACTIONED', 'DISMISSED')),
  idempotency_key   uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       bigint REFERENCES app.staff_user,
  UNIQUE (reporter_id, idempotency_key)
);
CREATE INDEX report_queue ON ident.report (status, priority, created_at) WHERE status IN ('OPEN', 'IN_REVIEW');

-- notification centre: newest first per recipient (copy is generic; never names an anonymous sender)
CREATE INDEX notification_feed ON ident.notification (recipient_id, id DESC);
