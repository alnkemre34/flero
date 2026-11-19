-- 0008: notification centre — opaque public ids (REQ-ID-01) so clients can page and mark-read without internal ids.
ALTER TABLE ident.notification ADD COLUMN public_id text NOT NULL UNIQUE DEFAULT app.opaque_id('ntf');
