PRAGMA foreign_keys = ON;

-- Poll is a native activity. Participant and Session ownership remain in the
-- shared activity framework; these tables only store Poll-specific content.
ALTER TABLE session_participant_identities ADD COLUMN display_name TEXT;
ALTER TABLE session_participant_identities ADD COLUMN role TEXT NOT NULL DEFAULT '';
ALTER TABLE session_participant_identities ADD COLUMN team_name TEXT;

CREATE TABLE poll_configs (
  activity_id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single', 'multiple')),
  max_selections INTEGER NOT NULL DEFAULT 1 CHECK (max_selections BETWEEN 1 AND 10),
  allow_other INTEGER NOT NULL DEFAULT 0 CHECK (allow_other IN (0, 1)),
  identity_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (identity_mode IN ('anonymous', 'named')),
  participant_results_mode TEXT NOT NULL DEFAULT 'presenter_only' CHECK (participant_results_mode IN ('presenter_only', 'presenter_and_participant')),
  reveal_state TEXT NOT NULL DEFAULT 'hidden' CHECK (reveal_state IN ('hidden', 'revealed')),
  access_slug TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  reopened_at TEXT,
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 9),
  is_other INTEGER NOT NULL DEFAULT 0 CHECK (is_other IN (0, 1)),
  UNIQUE (activity_id, sort_order),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_poll_one_other_option ON poll_options(activity_id) WHERE is_other = 1;

-- Completion identity is intentionally separate from answer storage.
CREATE TABLE poll_participations (
  activity_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  has_submitted INTEGER NOT NULL DEFAULT 0 CHECK (has_submitted IN (0, 1)),
  submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id, participant_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- voter_key is an HMAC-like keyed hash of poll + participant identity. It is
-- never returned by any API. Anonymous responses have no participant FK.
CREATE TABLE poll_responses (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  other_text TEXT,
  named_participant_id TEXT,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_id, voter_key),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (named_participant_id) REFERENCES participants(id) ON DELETE SET NULL
);
CREATE TABLE poll_response_options (
  response_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  PRIMARY KEY (response_id, option_id),
  FOREIGN KEY (response_id) REFERENCES poll_responses(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
);

-- Keys are retained to make network retries idempotent even after later edits.
CREATE TABLE poll_idempotency_requests (
  activity_id TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id, voter_key, idempotency_key),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE poll_control_audit (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- Session entry is a shared landing route for all currently Live Polls.
CREATE TABLE poll_session_access (
  session_id TEXT PRIMARY KEY,
  access_slug TEXT NOT NULL UNIQUE,
  join_pin TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_poll_options_activity_sort ON poll_options(activity_id, sort_order);
CREATE INDEX idx_poll_participations_submitted ON poll_participations(activity_id, has_submitted);
CREATE INDEX idx_poll_response_options_option ON poll_response_options(option_id, response_id);
CREATE INDEX idx_poll_responses_activity_time ON poll_responses(activity_id, submitted_at);
CREATE INDEX idx_poll_audit_activity_time ON poll_control_audit(activity_id, created_at);
