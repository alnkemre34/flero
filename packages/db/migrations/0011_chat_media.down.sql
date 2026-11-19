-- rollback of 0011_chat_media (applied by hand; the runner never applies .down.sql files)
DROP INDEX IF EXISTS ident.media_object_expiry;
DROP INDEX IF EXISTS ident.media_object_by_owner;
ALTER TABLE ident.media_unlock DROP COLUMN IF EXISTS grace_used, DROP COLUMN IF EXISTS bytes_delivered_at;
ALTER TABLE ident.media_object
  DROP COLUMN IF EXISTS height, DROP COLUMN IF EXISTS width, DROP COLUMN IF EXISTS message_seq,
  DROP COLUMN IF EXISTS client_msg_id, DROP COLUMN IF EXISTS upload_expires_at, DROP COLUMN IF EXISTS max_bytes,
  DROP COLUMN IF EXISTS content_type, DROP COLUMN IF EXISTS quarantine_key;
DELETE FROM public.schema_migrations WHERE version = '0011_chat_media';
