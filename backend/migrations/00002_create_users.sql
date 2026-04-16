-- +goose Up
-- Create users table for authentication (Authboss-backed).

CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT UNIQUE NOT NULL,
    password_hash       TEXT,
    role                TEXT NOT NULL DEFAULT 'user',
    oauth_providers     JSONB DEFAULT '{}',
    instrument_settings JSONB DEFAULT '{}',
    preferences         JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for email lookups (covered by UNIQUE, but explicit for clarity).
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Remember-me tokens table for Authboss remember module.
CREATE TABLE IF NOT EXISTS remember_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    token      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remember_tokens_email ON remember_tokens (user_email);
CREATE INDEX IF NOT EXISTS idx_remember_tokens_token ON remember_tokens (user_email, token);

-- +goose Down
DROP TABLE IF EXISTS remember_tokens;
DROP TABLE IF EXISTS users;
