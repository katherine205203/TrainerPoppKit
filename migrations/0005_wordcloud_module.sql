PRAGMA foreign_keys = ON;

-- Word Cloud is a specialised activity attached to the existing activities,
-- sessions, teams, owner cookie and guest-token infrastructure.
CREATE TABLE wordcloud_configs (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 200),
  max_words INTEGER NOT NULL DEFAULT 3 CHECK (max_words BETWEEN 1 AND 10),
  phase TEXT NOT NULL DEFAULT 'DRAFT' CHECK (phase IN ('DRAFT','READY','OPEN','CLOSED','ARCHIVED')),
  visibility TEXT NOT NULL DEFAULT 'HIDDEN' CHECK (visibility IN ('HIDDEN','LIVE_REVEAL')),
  started_once INTEGER NOT NULL DEFAULT 0 CHECK (started_once IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  active_team_filter TEXT REFERENCES teams(id) ON DELETE SET NULL,
  access_slug TEXT NOT NULL UNIQUE,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- This one-way, opaque receipt is separate from Word Cloud content. It has no
-- participant FK and no pointer to an anonymous submission row.
CREATE TABLE wordcloud_access_receipts (
  activity_id TEXT NOT NULL REFERENCES wordcloud_configs(activity_id) ON DELETE CASCADE,
  access_proof_hash TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted INTEGER NOT NULL DEFAULT 0 CHECK (submitted IN (0,1)),
  submitted_at TEXT,
  PRIMARY KEY (activity_id, access_proof_hash)
);

-- No name, email, participant ID, receipt hash, join token, device ID or IP.
CREATE TABLE wordcloud_anonymous_submissions (
  submission_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES wordcloud_configs(activity_id) ON DELETE CASCADE,
  team_id_snapshot TEXT REFERENCES teams(id) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_wordcloud_submissions_activity_team
  ON wordcloud_anonymous_submissions(activity_id, team_id_snapshot);

CREATE TABLE wordcloud_terms (
  term_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES wordcloud_configs(activity_id) ON DELETE CASCADE,
  normalized_key TEXT NOT NULL,
  canonical_label TEXT NOT NULL,
  UNIQUE(activity_id, normalized_key),
  UNIQUE(activity_id, term_id)
);

CREATE TABLE wordcloud_response_terms (
  submission_id TEXT NOT NULL REFERENCES wordcloud_anonymous_submissions(submission_id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES wordcloud_terms(term_id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  PRIMARY KEY (submission_id, term_id)
);
CREATE INDEX ix_wordcloud_response_terms_term ON wordcloud_response_terms(term_id, submission_id);

CREATE TABLE wordcloud_display_groups (
  group_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES wordcloud_configs(activity_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(activity_id, group_id)
);
CREATE INDEX ix_wordcloud_groups_activity_hidden
  ON wordcloud_display_groups(activity_id, hidden, label);

CREATE TABLE wordcloud_group_memberships (
  term_id TEXT PRIMARY KEY REFERENCES wordcloud_terms(term_id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES wordcloud_display_groups(group_id) ON DELETE CASCADE
);
CREATE INDEX ix_wordcloud_memberships_group ON wordcloud_group_memberships(group_id, term_id);

CREATE TABLE wordcloud_moderation_operations (
  operation_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES wordcloud_configs(activity_id) ON DELETE CASCADE,
  actor_trainer_id TEXT NOT NULL DEFAULT 'owner',
  op_type TEXT NOT NULL CHECK (op_type IN ('HIDE','RESTORE','MERGE','UNMERGE')),
  before_state_json TEXT NOT NULL,
  after_state_json TEXT NOT NULL,
  reversed_by TEXT REFERENCES wordcloud_moderation_operations(operation_id) ON DELETE SET NULL,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_wordcloud_moderation_activity
  ON wordcloud_moderation_operations(activity_id, created_at DESC);

-- The moderation operation and its guarded revision advance share one D1 batch.
-- A stale revision aborts and rolls back the complete batch.
CREATE TRIGGER wordcloud_moderation_revision_guard
BEFORE INSERT ON wordcloud_moderation_operations
WHEN NOT EXISTS (
  SELECT 1 FROM wordcloud_configs
  WHERE activity_id = NEW.activity_id AND revision = NEW.resulting_revision
)
BEGIN
  SELECT RAISE(ABORT, 'CONFLICT_VERSION');
END;
