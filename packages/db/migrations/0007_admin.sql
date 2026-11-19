-- 0007: admin plane — staff sessions, approval execution, home banners.

CREATE TABLE app.staff_session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    bigint NOT NULL REFERENCES app.staff_user,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX staff_session_by_staff ON app.staff_session (staff_id) WHERE revoked_at IS NULL;

-- an approved request is executed exactly once
ALTER TABLE app.approval ADD COLUMN executed_at timestamptz;
ALTER TABLE app.approval ADD CONSTRAINT approval_execute_after_approve CHECK (executed_at IS NULL OR decision = 'APPROVED');
CREATE INDEX approval_pending ON app.approval (created_at) WHERE decision IS NULL;

-- home banners: allowlisted in-app destinations only (REQ-HOM-01); sponsored is always disclosed
CREATE TABLE app.banner (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   text NOT NULL UNIQUE DEFAULT app.opaque_id('bnr'),
  placement   text NOT NULL DEFAULT 'HOME' CHECK (placement IN ('HOME', 'WALLET', 'SHUFFLE')),
  image_url   text NOT NULL CHECK (image_url ~ '^https://'),
  alt_key     text NOT NULL CHECK (alt_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  destination text NOT NULL CHECK (destination ~ '^flero://[a-z/_-]{1,64}$'),
  sponsored   boolean NOT NULL DEFAULT false,
  priority    int NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX banner_live ON app.banner (placement, priority DESC) WHERE active;

-- audit chain head lookup
CREATE INDEX audit_event_recent ON app.audit_event (id DESC);
