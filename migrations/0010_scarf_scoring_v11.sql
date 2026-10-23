-- Scoring v1.1.0 keeps the original Reaction Intensity and Driver Priority
-- while storing a separately derived Integrated Needs Profile. Existing v0.2
-- result rows intentionally remain NULL in the new fields.
ALTER TABLE scarf_results ADD COLUMN tradeoff_json TEXT;
ALTER TABLE scarf_results ADD COLUMN ranking_json TEXT;
ALTER TABLE scarf_results ADD COLUMN integrated_needs_index_json TEXT;
ALTER TABLE scarf_results ADD COLUMN integrated_needs_rank_json TEXT;
ALTER TABLE scarf_results ADD COLUMN scoring_metadata_json TEXT;

CREATE INDEX idx_scarf_results_scoring_version ON scarf_results(scoring_version, instrument_version, submitted_at);
