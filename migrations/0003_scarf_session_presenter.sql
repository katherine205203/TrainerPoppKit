PRAGMA foreign_keys = ON;

CREATE TABLE scarf_presenter_sessions_new (
  token_hash TEXT PRIMARY KEY,
  activity_id TEXT REFERENCES activities(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((activity_id IS NOT NULL AND session_id IS NULL) OR (activity_id IS NULL AND session_id IS NOT NULL))
);

INSERT INTO scarf_presenter_sessions_new (token_hash, activity_id, session_id, expires_at, revoked_at, created_at)
SELECT token_hash, activity_id, NULL, expires_at, revoked_at, created_at FROM scarf_presenter_sessions;

DROP TABLE scarf_presenter_sessions;
ALTER TABLE scarf_presenter_sessions_new RENAME TO scarf_presenter_sessions;

CREATE INDEX idx_scarf_presenter_activity_expiry ON scarf_presenter_sessions(activity_id, expires_at, revoked_at);
CREATE INDEX idx_scarf_presenter_session_expiry ON scarf_presenter_sessions(session_id, expires_at, revoked_at);

CREATE TABLE scarf_session_presentation_state (
  session_id TEXT PRIMARY KEY,
  revealed INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
  selected_team_name TEXT,
  scarf_layer TEXT NOT NULL DEFAULT 'reaction' CHECK (scarf_layer IN ('reaction', 'priority')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
