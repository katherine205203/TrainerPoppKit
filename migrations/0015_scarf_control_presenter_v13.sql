PRAGMA foreign_keys = ON;

-- SCARF v1.3 separates the audience presentation lifecycle from personal-result release.
ALTER TABLE presentation_state ADD COLUMN presenter_stage TEXT NOT NULL DEFAULT 'lobby'
  CHECK (presenter_stage IN ('lobby', 'closed_waiting', 'heatmap_revealed'));
ALTER TABLE presentation_state ADD COLUMN presenter_view TEXT NOT NULL DEFAULT 'individual'
  CHECK (presenter_view IN ('individual', 'team'));
ALTER TABLE presentation_state ADD COLUMN presenter_comparison TEXT NOT NULL DEFAULT 'personal_pattern'
  CHECK (presenter_comparison IN ('personal_pattern', 'compared_to_class'));

UPDATE presentation_state
SET presenter_stage = CASE WHEN revealed = 1 THEN 'heatmap_revealed' ELSE 'lobby' END,
    presenter_view = CASE WHEN selected_team_id IS NOT NULL THEN 'team' ELSE 'individual' END,
    presenter_comparison = CASE WHEN comparison_basis = 'team_relative' THEN 'compared_to_class' ELSE 'personal_pattern' END;
