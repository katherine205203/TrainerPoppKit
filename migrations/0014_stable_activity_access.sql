PRAGMA foreign_keys = ON;

ALTER TABLE activities ADD COLUMN access_slug TEXT;
UPDATE activities SET access_slug = lower(hex(randomblob(16))) WHERE access_slug IS NULL;
CREATE UNIQUE INDEX ix_activities_access_slug ON activities(access_slug) WHERE access_slug IS NOT NULL;

-- Module-specific Activity creation APIs also receive a shared stable URL.
CREATE TRIGGER activities_access_slug_after_insert
AFTER INSERT ON activities
WHEN NEW.access_slug IS NULL
BEGIN
  UPDATE activities SET access_slug = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
