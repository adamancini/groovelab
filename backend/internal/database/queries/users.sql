-- name: CreateUser :one
INSERT INTO users (email, password_hash, role, name)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, role, name, oauth_providers, instrument_settings, preferences, created_at, updated_at;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, role, name, oauth_providers, instrument_settings, preferences, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, password_hash, role, name, oauth_providers, instrument_settings, preferences, created_at, updated_at
FROM users
WHERE id = $1;

-- name: UpdateUser :one
UPDATE users
SET email = $2,
    password_hash = $3,
    role = $4,
    name = $5,
    oauth_providers = $6,
    instrument_settings = $7,
    preferences = $8,
    updated_at = now()
WHERE id = $1
RETURNING id, email, password_hash, role, name, oauth_providers, instrument_settings, preferences, created_at, updated_at;

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: AddRememberToken :exec
INSERT INTO remember_tokens (user_email, token)
VALUES ($1, $2);

-- name: UseRememberToken :one
DELETE FROM remember_tokens
WHERE user_email = $1 AND token = $2
RETURNING id;

-- name: DeleteRememberTokens :exec
DELETE FROM remember_tokens
WHERE user_email = $1;
