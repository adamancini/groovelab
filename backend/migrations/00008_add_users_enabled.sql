-- +goose Up
-- Add enabled column to users table for admin user management.
ALTER TABLE users ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE users DROP COLUMN enabled;
