-- +goose Up
-- Create streaks table for daily practice and session streak tracking.

CREATE TABLE IF NOT EXISTS streaks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    practice_date         DATE NOT NULL,
    session_correct_streak INT NOT NULL DEFAULT 0,
    session_best_streak   INT NOT NULL DEFAULT 0,
    UNIQUE (user_id, practice_date)
);

CREATE INDEX IF NOT EXISTS idx_streaks_user_id ON streaks (user_id);
CREATE INDEX IF NOT EXISTS idx_streaks_user_date ON streaks (user_id, practice_date DESC);

-- +goose Down
DROP TABLE IF EXISTS streaks;
