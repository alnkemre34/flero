-- 0010: avatar uploads. The client uploads the original into quarantine through a short-lived ticket; the server
-- re-encodes it (crop, EXIF stripped, fixed size) into a fresh random key and only then swaps profile.avatar_key.
-- The previous avatar stays visible until the new one is READY (contract: completeAvatarUpload).
CREATE TABLE app.avatar_upload (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   bigint NOT NULL REFERENCES app.account,
  object_key   text NOT NULL UNIQUE,                    -- quarantine/… (never served)
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heif')),
  max_bytes    int NOT NULL CHECK (max_bytes BETWEEN 1 AND 15000000),
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'UPLOADED', 'READY', 'REJECTED', 'EXPIRED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX avatar_upload_by_account ON app.avatar_upload (account_id, created_at DESC);
-- the served avatar key is random and unrelated to the account id (REQ-ID-01)
ALTER TABLE app.profile ADD CONSTRAINT avatar_key_shape CHECK (avatar_key IS NULL OR avatar_key ~ '^[a-z2-7]{26}$');
