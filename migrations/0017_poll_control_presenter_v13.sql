PRAGMA foreign_keys = ON;

-- Poll v1.3 keeps authoring immutable after a Run starts and stores the
-- public presentation mode separately from the current Run lifecycle.
ALTER TABLE poll_configs ADD COLUMN presentation_mode TEXT NOT NULL DEFAULT 'close_reveal'
  CHECK (presentation_mode IN ('live_results', 'close_reveal'));

-- One shared public Presenter context per Session, or one Poll-scoped context
-- for standalone Polls. Freeze is an ephemeral display snapshot only; the
-- Poll response tables remain the source of truth for Trainer analytics/CSV.
CREATE TABLE poll_presenter_contexts (
  context_key TEXT PRIMARY KEY,
  session_id TEXT,
  activity_id TEXT,
  spotlight_activity_id TEXT,
  display_state TEXT NOT NULL DEFAULT 'JOIN_LOBBY'
    CHECK (display_state IN ('JOIN_LOBBY', 'VOTING_HIDDEN', 'LIVE_RESULTS', 'ACTIVITY_CLOSED', 'FINAL_RESULTS', 'FROZEN_RESULTS', 'EMPTY_RESULTS', 'RECONNECTING')),
  frozen_snapshot_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (spotlight_activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  CHECK ((session_id IS NOT NULL AND activity_id IS NULL) OR (session_id IS NULL AND activity_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_poll_presenter_context_session ON poll_presenter_contexts(session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_poll_presenter_context_activity ON poll_presenter_contexts(activity_id) WHERE activity_id IS NOT NULL;

-- Presenter links are read-only and can point at a shared Session context.
CREATE TABLE poll_presenter_sessions (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT,
  activity_id TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  CHECK ((session_id IS NOT NULL AND activity_id IS NULL) OR (session_id IS NULL AND activity_id IS NOT NULL))
);
CREATE INDEX idx_poll_presenter_session_expiry ON poll_presenter_sessions(session_id, expires_at, revoked_at);
CREATE INDEX idx_poll_presenter_activity_expiry ON poll_presenter_sessions(activity_id, expires_at, revoked_at);
