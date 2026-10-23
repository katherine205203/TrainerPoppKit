PRAGMA foreign_keys = ON;

-- A session-scoped guest identity lets activity-level participation stay separate
-- while session analytics can select the latest response from each returning guest.
CREATE TABLE session_participant_identities (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

ALTER TABLE participants ADD COLUMN session_identity_id TEXT REFERENCES session_participant_identities(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_participants_session_identity_activity
  ON participants(activity_id, session_identity_id)
  WHERE session_identity_id IS NOT NULL;

ALTER TABLE presentation_state ADD COLUMN scarf_layer TEXT NOT NULL DEFAULT 'reaction'
  CHECK (scarf_layer IN ('reaction', 'priority'));

CREATE TABLE scarf_activity_configs (
  activity_id TEXT PRIMARY KEY,
  instrument_key TEXT NOT NULL CHECK (instrument_key = 'SCARF_DRIVERS'),
  instrument_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  content_hash TEXT NOT NULL,
  release_mode TEXT NOT NULL CHECK (release_mode IN ('immediate', 'trainer_released')),
  results_released_at TEXT,
  release_locked_at TEXT,
  team_mode TEXT NOT NULL DEFAULT 'activity' CHECK (team_mode IN ('activity', 'none')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE scarf_participations (
  participant_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  current_question INTEGER NOT NULL DEFAULT 1 CHECK (current_question BETWEEN 1 AND 30),
  view_state TEXT NOT NULL DEFAULT 'welcome' CHECK (view_state IN ('welcome', 'question', 'transition', 'completed')),
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_id, participant_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TABLE scarf_answers (
  participant_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  question_id TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (participant_id, generation, question_id),
  FOREIGN KEY (participant_id) REFERENCES scarf_participations(participant_id) ON DELETE CASCADE
);

CREATE TABLE scarf_results (
  participant_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  instrument_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  reaction_json TEXT NOT NULL,
  priority_json TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (participant_id, generation),
  FOREIGN KEY (participant_id) REFERENCES scarf_participations(participant_id) ON DELETE CASCADE
);

CREATE TABLE scarf_audit_events (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'participant', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE scarf_presenter_sessions (
  token_hash TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX idx_scarf_configs_versions ON scarf_activity_configs(instrument_version, scoring_version, locale);
CREATE INDEX idx_scarf_participations_activity_status ON scarf_participations(activity_id, status);
CREATE INDEX idx_scarf_answers_participant_generation ON scarf_answers(participant_id, generation);
CREATE INDEX idx_scarf_results_version ON scarf_results(instrument_version, scoring_version, submitted_at);
CREATE INDEX idx_scarf_audit_activity_time ON scarf_audit_events(activity_id, created_at);
CREATE INDEX idx_scarf_presenter_activity_expiry ON scarf_presenter_sessions(activity_id, expires_at, revoked_at);
