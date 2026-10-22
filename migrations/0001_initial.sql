PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  expected_participants INTEGER NOT NULL DEFAULT 0 CHECK (expected_participants >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'upcoming', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  title TEXT NOT NULL,
  tool_id TEXT NOT NULL DEFAULT 'scarf-demo',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'paused', 'closed', 'archived')),
  result_policy TEXT NOT NULL DEFAULT 'trainer_reveal' CHECK (result_policy IN ('trainer_reveal', 'immediate', 'confirmation')),
  require_name INTEGER NOT NULL DEFAULT 1 CHECK (require_name IN (0, 1)),
  allow_teams INTEGER NOT NULL DEFAULT 1 CHECK (allow_teams IN (0, 1)),
  join_pin TEXT UNIQUE,
  join_token_hash TEXT,
  presenter_token_hash TEXT,
  instrument_version TEXT NOT NULL DEFAULT 'demo-items-v0',
  scoring_version TEXT NOT NULL DEFAULT 'demo-likert-v0',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  team_id TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  consent_named_results INTEGER NOT NULL DEFAULT 0 CHECK (consent_named_results IN (0, 1)),
  token_hash TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  scores_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  instrument_version TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  payload_hash TEXT,
  submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_id, participant_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TABLE presentation_state (
  activity_id TEXT PRIMARY KEY,
  revealed INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
  comparison_basis TEXT NOT NULL DEFAULT 'within_person' CHECK (comparison_basis IN ('within_person', 'team_relative')),
  selected_team_id TEXT,
  show_names INTEGER NOT NULL DEFAULT 0 CHECK (show_names IN (0, 1)),
  prompt_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE join_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_activities_session_state ON activities(session_id, state);
CREATE INDEX idx_participants_activity ON participants(activity_id, joined_at);
CREATE INDEX idx_submissions_activity_status ON submissions(activity_id, status);
