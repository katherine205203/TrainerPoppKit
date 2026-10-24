PRAGMA foreign_keys = ON;

CREATE TABLE quiz_definitions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RETIRED')),
  published_version INTEGER NOT NULL DEFAULT 0, draft_json TEXT NOT NULL, published_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE quiz_activities (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL REFERENCES quiz_definitions(id)
);
CREATE TABLE quiz_runs (
  id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, name TEXT NOT NULL, run_type TEXT NOT NULL CHECK(run_type IN ('LIVE','SELF_PACED')),
  competition_mode TEXT, hosting_mode TEXT, scoring_mode TEXT,
  config_json TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'LOBBY_OPEN' CHECK(state IN ('LOBBY_OPEN','RUNNING','PAUSED','COMPLETED')),
  phase TEXT NOT NULL DEFAULT 'LOBBY', current_index INTEGER NOT NULL DEFAULT -1,
  phase_started_at INTEGER, phase_deadline_at INTEGER, phase_remaining_ms INTEGER, paused_from_phase TEXT,
  active_elapsed_ms INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
  completion_reason TEXT, presenter_token_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at INTEGER, completed_at INTEGER,
  UNIQUE(activity_id,sequence)
);
CREATE UNIQUE INDEX quiz_one_active_run ON quiz_runs(activity_id) WHERE state != 'COMPLETED';
CREATE INDEX quiz_run_activity_history ON quiz_runs(activity_id,sequence DESC);
CREATE TABLE quiz_run_teams (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort_order INTEGER NOT NULL, UNIQUE(run_id,name)
);
CREATE TABLE quiz_run_participants (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL, normalized_nickname TEXT NOT NULL, team_id TEXT REFERENCES quiz_run_teams(id),
  token_hash TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, disqualified_at INTEGER, disqualification_reason TEXT,
  UNIQUE(run_id,normalized_nickname)
);
CREATE INDEX quiz_participant_run ON quiz_run_participants(run_id);
CREATE TABLE quiz_question_eligibility (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL, participant_id TEXT NOT NULL REFERENCES quiz_run_participants(id) ON DELETE CASCADE,
  PRIMARY KEY(run_id,question_index,participant_id)
);
CREATE TABLE quiz_live_answers (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL, participant_id TEXT NOT NULL REFERENCES quiz_run_participants(id) ON DELETE CASCADE,
  selected_json TEXT NOT NULL, accepted_at INTEGER NOT NULL, effective_elapsed_ms INTEGER NOT NULL, request_id TEXT NOT NULL,
  UNIQUE(run_id,question_index,participant_id), UNIQUE(run_id,request_id)
);
CREATE TABLE quiz_locked_questions (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL, locked_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,question_index)
);
CREATE TABLE quiz_attempts (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES quiz_run_participants(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'NOT_STARTED', started_at INTEGER, deadline_at INTEGER, submitted_at INTEGER, submit_reason TEXT,
  PRIMARY KEY(run_id,participant_id)
);
CREATE TABLE quiz_drafts (
  run_id TEXT NOT NULL, participant_id TEXT NOT NULL, question_index INTEGER NOT NULL,
  selected_json TEXT NOT NULL, version INTEGER NOT NULL, saved_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,participant_id,question_index),
  FOREIGN KEY(run_id,participant_id) REFERENCES quiz_attempts(run_id,participant_id) ON DELETE CASCADE
);
CREATE TABLE quiz_question_corrections (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL, correct_json TEXT, voided INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(run_id,question_index)
);
CREATE TABLE quiz_result_revisions (
  run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, change_type TEXT NOT NULL, reason TEXT NOT NULL,
  actor TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,revision)
);
CREATE TABLE quiz_audit (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT,
  before_json TEXT, after_json TEXT, reason TEXT, at INTEGER NOT NULL
);
CREATE INDEX quiz_audit_run_time ON quiz_audit(run_id,at);
