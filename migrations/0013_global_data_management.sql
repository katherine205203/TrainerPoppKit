PRAGMA foreign_keys = ON;

ALTER TABLE sessions ADD COLUMN access_slug TEXT;
ALTER TABLE sessions ADD COLUMN join_pin TEXT;
ALTER TABLE sessions ADD COLUMN join_generation INTEGER NOT NULL DEFAULT 1 CHECK (join_generation >= 1);
ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
ALTER TABLE sessions ADD COLUMN archived_at TEXT;
ALTER TABLE sessions ADD COLUMN archive_manifest_json TEXT;
CREATE UNIQUE INDEX ix_sessions_access_slug ON sessions(access_slug) WHERE access_slug IS NOT NULL;
CREATE UNIQUE INDEX ix_sessions_join_pin ON sessions(join_pin) WHERE join_pin IS NOT NULL;

ALTER TABLE activities ADD COLUMN deleted_at TEXT;
ALTER TABLE activities ADD COLUMN current_run_id TEXT;
CREATE INDEX ix_activities_deleted ON activities(deleted_at, session_id, updated_at);

ALTER TABLE quiz_runs ADD COLUMN origin_session_id TEXT;
ALTER TABLE quiz_runs ADD COLUMN origin_session_name TEXT;
ALTER TABLE quiz_runs ADD COLUMN deleted_at TEXT;
ALTER TABLE quiz_runs ADD COLUMN permanent_deleted_at TEXT;

CREATE TABLE gdm_runs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  origin_session_id TEXT,
  origin_session_name TEXT,
  state TEXT NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','LIVE','PAUSED','CLOSED','ARCHIVED','HISTORY')),
  config_json TEXT NOT NULL DEFAULT '{}',
  data_json TEXT,
  export_csv TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  ended_at TEXT,
  deleted_at TEXT,
  permanent_deleted_at TEXT,
  trash_package_id TEXT
);
CREATE UNIQUE INDEX ix_gdm_run_sequence ON gdm_runs(activity_id, sequence);
CREATE UNIQUE INDEX ix_gdm_current_run ON gdm_runs(activity_id) WHERE is_current = 1 AND permanent_deleted_at IS NULL;
CREATE INDEX ix_gdm_runs_origin ON gdm_runs(origin_session_id, activity_id, sequence);
CREATE INDEX ix_gdm_runs_trash ON gdm_runs(deleted_at, permanent_deleted_at);

CREATE TABLE gdm_trash_packages (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('SESSION','ACTIVITY','RUN','BULK')),
  action TEXT NOT NULL CHECK (action IN ('DELETE_SESSION_ONLY','DELETE_SESSION_ALL','DELETE_ACTIVITY','DELETE_RUN','BULK_DELETE')),
  label TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  restored_at TEXT,
  purged_at TEXT
);
CREATE INDEX ix_gdm_trash_expiry ON gdm_trash_packages(expires_at, restored_at, purged_at);

CREATE TABLE gdm_audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'owner',
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_gdm_audit_object ON gdm_audit_events(object_type, object_id, created_at);

CREATE TABLE gdm_operations (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','DONE','FAILED')),
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Legacy Quiz Runs already have immutable question/config snapshots and independent
-- participant tables. Map their IDs into the shared Run ledger without copying answers.
INSERT INTO gdm_runs (id, activity_id, sequence, origin_session_id, origin_session_name, state, config_json,
  data_json, is_current, created_at, started_at, ended_at, deleted_at)
SELECT qr.id, qr.activity_id, qr.sequence, a.session_id, s.name,
  CASE WHEN qr.state = 'PAUSED' THEN 'PAUSED' WHEN qr.state = 'COMPLETED' THEN 'CLOSED' ELSE 'LIVE' END,
  json_object('config', qr.config_json, 'quizSnapshot', qr.snapshot_json), NULL,
  CASE WHEN qr.sequence = (SELECT MAX(latest.sequence) FROM quiz_runs latest WHERE latest.activity_id = qr.activity_id) THEN 1 ELSE 0 END,
  qr.created_at, CASE WHEN qr.started_at IS NULL THEN NULL ELSE datetime(qr.started_at, 'unixepoch') END,
  CASE WHEN qr.completed_at IS NULL THEN NULL ELSE datetime(qr.completed_at, 'unixepoch') END, qr.deleted_at
FROM quiz_runs qr JOIN activities a ON a.id = qr.activity_id LEFT JOIN sessions s ON s.id = a.session_id;

UPDATE quiz_runs SET origin_session_id = (SELECT a.session_id FROM activities a WHERE a.id = quiz_runs.activity_id),
  origin_session_name = (SELECT s.name FROM activities a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.id = quiz_runs.activity_id);

-- Every existing non-Quiz Activity starts with one current Run. Activity data remains
-- in its module tables until a Start New/Reset operation snapshots and clears it.
INSERT INTO gdm_runs (id, activity_id, sequence, origin_session_id, origin_session_name, state, config_json, is_current, created_at)
SELECT lower(hex(randomblob(16))), a.id, 1, a.session_id, s.name,
  CASE WHEN a.state IN ('open','paused') THEN CASE WHEN a.state='paused' THEN 'PAUSED' ELSE 'LIVE' END
       WHEN a.state='archived' THEN 'ARCHIVED' WHEN a.state='closed' THEN 'CLOSED' ELSE 'READY' END,
  '{}', 1, a.created_at
FROM activities a LEFT JOIN sessions s ON s.id=a.session_id
WHERE a.tool_id != 'quiz' AND NOT EXISTS (SELECT 1 FROM gdm_runs r WHERE r.activity_id=a.id);

UPDATE activities SET current_run_id = (SELECT r.id FROM gdm_runs r WHERE r.activity_id=activities.id AND r.is_current=1 LIMIT 1);

-- Preserve existing Poll Session links/PINs as the stable Session access record.
UPDATE sessions SET access_slug = (SELECT access_slug FROM poll_session_access p WHERE p.session_id=sessions.id),
  join_pin = (SELECT join_pin FROM poll_session_access p WHERE p.session_id=sessions.id)
WHERE EXISTS (SELECT 1 FROM poll_session_access p WHERE p.session_id=sessions.id);
