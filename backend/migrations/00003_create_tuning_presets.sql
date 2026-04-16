-- +goose Up
-- Create tuning_presets table and seed with standard bass tunings.

CREATE TABLE IF NOT EXISTS tuning_presets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    string_count INT NOT NULL,
    pitches      JSONB NOT NULL,
    is_default   BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tuning_presets_string_count ON tuning_presets (string_count);

-- Seed the 7 standard bass tuning presets.
INSERT INTO tuning_presets (name, string_count, pitches, is_default) VALUES
    ('Standard 4',        4, '["E1","A1","D2","G2"]',                     true),
    ('Drop D 4',          4, '["D1","A1","D2","G2"]',                     false),
    ('Half-step Down 4',  4, '["Eb1","Ab1","Db2","Gb2"]',                 false),
    ('Standard 5',        5, '["B0","E1","A1","D2","G2"]',                true),
    ('Drop A 5',          5, '["A0","E1","A1","D2","G2"]',                false),
    ('Standard 6',        6, '["B0","E1","A1","D2","G2","C3"]',           true),
    ('Half-step Down 6',  6, '["Bb0","Eb1","Ab1","Db2","Gb2","B2"]',     false);

-- +goose Down
DROP TABLE IF EXISTS tuning_presets;
