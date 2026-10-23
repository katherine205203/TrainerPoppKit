PRAGMA foreign_keys = ON;

-- Learning Behaviors Reflection is stored as an Activity subtype and reuses
-- the existing activity, participant, team and owner-auth tables.
CREATE TABLE lbr_activity_configs (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  intro TEXT NOT NULL DEFAULT '',
  behaviors_json TEXT NOT NULL,
  content_frozen_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lbr_progress (
  activity_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  current_phase TEXT NOT NULL DEFAULT 'SELF_DRAFT'
    CHECK (current_phase IN ('SELF_DRAFT','FEEDBACK_COLLECTION','MY_REFLECTION','MY_ACTIONS','COMPLETED')),
  started_at TEXT,
  last_step_index INTEGER NOT NULL DEFAULT 1 CHECK (last_step_index BETWEEN 1 AND 6),
  self_locked_at TEXT,
  feedback_phase_left_at TEXT,
  reflection_entered_at TEXT,
  actions_entered_at TEXT,
  ever_completed_at TEXT,
  reflection_text TEXT NOT NULL DEFAULT '' CHECK (length(reflection_text) <= 4000),
  actions_text TEXT NOT NULL DEFAULT '' CHECK (length(actions_text) <= 2000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id, participant_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE TABLE lbr_self_answers (
  activity_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  behavior_key TEXT NOT NULL CHECK (behavior_key IN ('asking_questions','sharing_information','seeking_help','experimenting','talking_about_mistakes','seeking_feedback')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_na INTEGER NOT NULL DEFAULT 0 CHECK (is_na IN (0,1)),
  evidence_text TEXT NOT NULL DEFAULT '' CHECK (length(evidence_text) <= 1000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id, participant_id, behavior_key),
  CHECK ((rating IS NULL) OR (is_na = 0)),
  FOREIGN KEY (activity_id, participant_id) REFERENCES lbr_progress(activity_id, participant_id) ON DELETE CASCADE
);

CREATE TABLE lbr_peer_rounds (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED')),
  payload_hash TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_id, participant_id, client_key),
  FOREIGN KEY (activity_id, participant_id) REFERENCES lbr_progress(activity_id, participant_id) ON DELETE CASCADE
);
CREATE INDEX ix_lbr_rounds_owner_status ON lbr_peer_rounds(activity_id, participant_id, status, created_at);

CREATE TABLE lbr_peer_answers (
  round_id TEXT NOT NULL REFERENCES lbr_peer_rounds(id) ON DELETE CASCADE,
  behavior_key TEXT NOT NULL CHECK (behavior_key IN ('asking_questions','sharing_information','seeking_help','experimenting','talking_about_mistakes','seeking_feedback')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_na INTEGER NOT NULL CHECK (is_na IN (0,1)),
  PRIMARY KEY (round_id, behavior_key),
  CHECK ((rating IS NULL AND is_na = 1) OR (rating BETWEEN 1 AND 5 AND is_na = 0))
);

CREATE TABLE lbr_quick_notes (
  round_id TEXT PRIMARY KEY REFERENCES lbr_peer_rounds(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL DEFAULT '' CHECK (length(note_text) <= 2000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_lbr_self_activity ON lbr_self_answers(activity_id, behavior_key, participant_id);
CREATE INDEX ix_lbr_peer_answers_behavior ON lbr_peer_answers(behavior_key, round_id);

-- The first saved Self answer freezes the shared content snapshot.
CREATE TRIGGER lbr_freeze_content_after_self_insert
AFTER INSERT ON lbr_self_answers
BEGIN
  UPDATE lbr_activity_configs SET content_frozen_at = COALESCE(content_frozen_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
  WHERE activity_id = NEW.activity_id;
END;
CREATE TRIGGER lbr_freeze_content_after_self_update
AFTER UPDATE OF rating, is_na, evidence_text ON lbr_self_answers
BEGIN
  UPDATE lbr_activity_configs SET content_frozen_at = COALESCE(content_frozen_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
  WHERE activity_id = NEW.activity_id;
END;

-- Ratings are immutable after lock, while evidence may still be edited by its owner.
CREATE TRIGGER lbr_self_lock_insert_guard
BEFORE INSERT ON lbr_self_answers
WHEN EXISTS (SELECT 1 FROM lbr_progress p WHERE p.activity_id = NEW.activity_id AND p.participant_id = NEW.participant_id AND p.self_locked_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'LBR_SELF_LOCKED');
END;
CREATE TRIGGER lbr_self_lock_update_guard
BEFORE UPDATE OF rating, is_na ON lbr_self_answers
WHEN EXISTS (
  SELECT 1 FROM lbr_progress p WHERE p.activity_id = NEW.activity_id AND p.participant_id = NEW.participant_id
    AND p.self_locked_at IS NOT NULL AND (p.self_locked_at IS NOT NULL)
) AND (OLD.rating IS NOT NEW.rating OR OLD.is_na != NEW.is_na)
BEGIN
  SELECT RAISE(ABORT, 'LBR_SELF_LOCKED');
END;

-- Submitted peer data is append-only; only owner-authored notes remain mutable.
CREATE TRIGGER lbr_peer_answer_insert_guard
BEFORE INSERT ON lbr_peer_answers
WHEN NOT EXISTS (SELECT 1 FROM lbr_peer_rounds r WHERE r.id = NEW.round_id AND r.status = 'DRAFT')
BEGIN
  SELECT RAISE(ABORT, 'LBR_PEER_ROUND_LOCKED');
END;
CREATE TRIGGER lbr_peer_answer_update_guard
BEFORE UPDATE ON lbr_peer_answers
WHEN EXISTS (SELECT 1 FROM lbr_peer_rounds r WHERE r.id = OLD.round_id AND r.status = 'SUBMITTED')
BEGIN
  SELECT RAISE(ABORT, 'LBR_PEER_ROUND_LOCKED');
END;
CREATE TRIGGER lbr_peer_answer_delete_guard
BEFORE DELETE ON lbr_peer_answers
WHEN EXISTS (SELECT 1 FROM lbr_peer_rounds r WHERE r.id = OLD.round_id AND r.status = 'SUBMITTED')
BEGIN
  SELECT RAISE(ABORT, 'LBR_PEER_ROUND_LOCKED');
END;
