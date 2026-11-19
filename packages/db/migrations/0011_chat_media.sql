-- 0011: chat photos (doc 08 §8, doc 12 §4). The sender uploads the original into quarantine through a short-lived
-- ticket; the server re-encodes it (EXIF/GPS stripped, max 1600 px), scans it, stores it under a random key and
-- only then posts the PHOTO message. The recipient sees a locked tile until a Gold unlock; the sender never pays.
ALTER TABLE ident.media_object
  ADD COLUMN quarantine_key    text UNIQUE,                     -- quarantine/chat/… (never served)
  ADD COLUMN content_type      text CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heif')),
  ADD COLUMN max_bytes         int CHECK (max_bytes BETWEEN 1 AND 15000000),
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN client_msg_id     uuid NOT NULL DEFAULT gen_random_uuid(), -- the PHOTO message's idempotency key
  ADD COLUMN message_seq       bigint,                            -- set once the PHOTO message is committed
  ADD COLUMN width             int,
  ADD COLUMN height            int;
CREATE INDEX media_object_by_owner ON ident.media_object (owner_id, created_at DESC);
CREATE INDEX media_object_expiry ON ident.media_object (expires_at) WHERE state = 'READY';

-- one-view lease protocol (doc 08 §8 step 5; DEC-25 default: one grace re-open within 10 minutes)
ALTER TABLE ident.media_unlock
  ADD COLUMN bytes_delivered_at timestamptz,   -- the leased URL served the whole image (single use)
  ADD COLUMN grace_used         boolean NOT NULL DEFAULT false;
-- expired media keep their rows (audit trail of the ledger link); the worker deletes only the stored bytes.
