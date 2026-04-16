-- +goose Up
-- Initial migration: creates the app_metadata table to verify goose is working.
-- The goose_db_version table (schema_migrations) is created automatically by goose.

CREATE TABLE IF NOT EXISTS app_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_metadata (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- +goose Down
DROP TABLE IF EXISTS app_metadata;
