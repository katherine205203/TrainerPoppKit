PRAGMA foreign_keys = ON;

-- Word Cloud v1.1 keeps the existing activity lifecycle and anonymous
-- submission tables, while making public presentation policy explicit.
ALTER TABLE wordcloud_configs ADD COLUMN presentation_mode TEXT NOT NULL DEFAULT 'CLOSE_AND_REVEAL'
  CHECK (presentation_mode IN ('LIVE_WORD_CLOUD','CLOSE_AND_REVEAL'));
ALTER TABLE wordcloud_configs ADD COLUMN presenter_revealed INTEGER NOT NULL DEFAULT 0
  CHECK (presenter_revealed IN (0,1));
ALTER TABLE wordcloud_configs ADD COLUMN presenter_hidden_override INTEGER NOT NULL DEFAULT 0
  CHECK (presenter_hidden_override IN (0,1));
ALTER TABLE wordcloud_configs ADD COLUMN presenter_team_filter TEXT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE wordcloud_configs ADD COLUMN presentation_revision INTEGER NOT NULL DEFAULT 0
  CHECK (presentation_revision >= 0);

-- Existing v1.0 activities stay trainer-controlled after migration so no
-- previously hidden cloud becomes public by accident. Word Cloud v1.1 also
-- needs a display name for the lobby; the name remains separate from terms.
UPDATE activities
SET require_name = 1
WHERE tool_id = 'wordcloud';

UPDATE wordcloud_configs
SET presentation_mode = 'CLOSE_AND_REVEAL',
    presenter_revealed = 0,
    presenter_hidden_override = 0,
    presenter_team_filter = NULL,
    presentation_revision = revision;
