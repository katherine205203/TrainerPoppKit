PRAGMA foreign_keys = ON;

ALTER TABLE reflection_wall_moderation_events
  ADD COLUMN reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 300);

DROP TRIGGER reflection_post_moderation_audit;
DROP TRIGGER reflection_comment_moderation_audit;
