PRAGMA foreign_keys = ON;

ALTER TABLE reflection_wall_configs
  ADD COLUMN access_enabled INTEGER NOT NULL DEFAULT 1 CHECK (access_enabled IN (0,1));

CREATE TABLE reflection_wall_moderation_events (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES reflection_wall_configs(activity_id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('post','comment')),
  item_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('HIDE','RESTORE')),
  moderator_role TEXT NOT NULL DEFAULT 'trainer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_reflection_moderation_activity ON reflection_wall_moderation_events(activity_id, created_at DESC);

CREATE TRIGGER reflection_post_moderation_audit AFTER UPDATE OF hidden ON reflection_wall_posts
WHEN OLD.hidden != NEW.hidden BEGIN
  INSERT INTO reflection_wall_moderation_events(id,activity_id,item_kind,item_id,action,moderator_role)
  VALUES (lower(hex(randomblob(16))),NEW.activity_id,'post',NEW.id,CASE NEW.hidden WHEN 1 THEN 'HIDE' ELSE 'RESTORE' END,'trainer');
END;

CREATE TRIGGER reflection_comment_moderation_audit AFTER UPDATE OF hidden ON reflection_wall_comments
WHEN OLD.hidden != NEW.hidden BEGIN
  INSERT INTO reflection_wall_moderation_events(id,activity_id,item_kind,item_id,action,moderator_role)
  VALUES (lower(hex(randomblob(16))),NEW.activity_id,'comment',NEW.id,CASE NEW.hidden WHEN 1 THEN 'HIDE' ELSE 'RESTORE' END,'trainer');
END;
