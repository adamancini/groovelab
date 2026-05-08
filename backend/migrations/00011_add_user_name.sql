-- +goose Up
-- Add name column to users table (GRO-0ar3).

ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS name;
