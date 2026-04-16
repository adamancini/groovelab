-- +goose Up
-- Create tracks table for user-saved practice tracks.

CREATE TABLE IF NOT EXISTS tracks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    chord_sequence    JSONB NOT NULL DEFAULT '[]',
    drum_pattern      JSONB NOT NULL DEFAULT '{}',
    bpm               INT NOT NULL DEFAULT 120,
    playback_settings JSONB DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks (user_id);

-- +goose Down
DROP TABLE IF EXISTS tracks;
