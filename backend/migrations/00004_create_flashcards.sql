-- +goose Up
-- Create cards, attempts, and mastery tables for the flashcard engine.

CREATE TABLE IF NOT EXISTS cards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic           TEXT NOT NULL,
    direction       TEXT NOT NULL,
    key_signature   TEXT NOT NULL,
    chord_type      TEXT,
    question        JSONB NOT NULL,
    correct_answer  JSONB NOT NULL,
    distractors     JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_topic ON cards (topic);
CREATE INDEX IF NOT EXISTS idx_cards_topic_direction ON cards (topic, direction);

CREATE TABLE IF NOT EXISTS attempts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id          UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    correct          BOOLEAN NOT NULL,
    input_method     TEXT NOT NULL,
    response_time_ms INT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_id ON attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_card_id ON attempts (card_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_card ON attempts (user_id, card_id);

CREATE TABLE IF NOT EXISTS mastery (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id             UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    stage               INT NOT NULL DEFAULT 0,
    consecutive_correct INT NOT NULL DEFAULT 0,
    consecutive_wrong   INT NOT NULL DEFAULT 0,
    accuracy            FLOAT NOT NULL DEFAULT 0,
    total_attempts      INT NOT NULL DEFAULT 0,
    last_practiced      TIMESTAMPTZ,
    UNIQUE(user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_mastery_user_id ON mastery (user_id);
CREATE INDEX IF NOT EXISTS idx_mastery_user_card ON mastery (user_id, card_id);

-- +goose Down
DROP TABLE IF EXISTS mastery;
DROP TABLE IF EXISTS attempts;
DROP TABLE IF EXISTS cards;
