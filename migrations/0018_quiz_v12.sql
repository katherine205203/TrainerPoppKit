PRAGMA foreign_keys = ON;

-- Quiz v1.2 keeps every published definition immutable while a mutable Draft
-- (or Draft Revision) continues to be edited independently.
CREATE TABLE quiz_definition_versions (
  definition_id TEXT NOT NULL REFERENCES quiz_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(definition_id, version)
);
CREATE TRIGGER quiz_definition_versions_no_update
BEFORE UPDATE ON quiz_definition_versions
BEGIN
  SELECT RAISE(ABORT, 'published Quiz versions are immutable');
END;
INSERT OR IGNORE INTO quiz_definition_versions(definition_id,version,content_json,created_at)
SELECT id,published_version,published_json,updated_at FROM quiz_definitions
WHERE published_version > 0 AND published_json IS NOT NULL;
ALTER TABLE quiz_definitions ADD COLUMN draft_base_version INTEGER;
ALTER TABLE quiz_activities ADD COLUMN definition_version INTEGER;
UPDATE quiz_activities SET definition_version=(
  SELECT published_version FROM quiz_definitions WHERE id=quiz_activities.definition_id
) WHERE definition_version IS NULL;

ALTER TABLE quiz_runs ADD COLUMN definition_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE quiz_runs ADD COLUMN final_results_visibility TEXT NOT NULL DEFAULT 'HIDDEN'
  CHECK(final_results_visibility IN ('HIDDEN','RELEASED'));
ALTER TABLE quiz_attempts ADD COLUMN question_order_json TEXT;
ALTER TABLE quiz_attempts ADD COLUMN current_position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_live_answers ADD COLUMN interacted INTEGER NOT NULL DEFAULT 1 CHECK(interacted IN (0,1));
ALTER TABLE quiz_drafts ADD COLUMN interacted INTEGER NOT NULL DEFAULT 1 CHECK(interacted IN (0,1));

-- Randomized display order is stored by stable IDs per participant and per
-- Presenter Run, so reloads never reshuffle an active question.
CREATE TABLE quiz_attempt_presentations (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES quiz_run_participants(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  item_order_json TEXT,
  right_order_json TEXT,
  PRIMARY KEY(run_id,participant_id,question_index)
);
CREATE TABLE quiz_run_presentations (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  item_order_json TEXT,
  right_order_json TEXT,
  PRIMARY KEY(run_id,question_index)
);

-- Older in-flight Run snapshots remain valid and are labelled as version 1.
UPDATE quiz_runs SET definition_version=COALESCE((
  SELECT qa.definition_version FROM quiz_activities qa WHERE qa.activity_id=quiz_runs.activity_id
),1) WHERE definition_version=1;
