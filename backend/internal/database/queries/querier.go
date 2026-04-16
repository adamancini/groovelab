package queries

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier executes type-safe SQL queries against the users table.
// This is a hand-written equivalent of sqlc-generated code.
type Querier struct {
	pool *pgxpool.Pool
}

// New creates a Querier backed by the given connection pool.
func New(pool *pgxpool.Pool) *Querier {
	return &Querier{pool: pool}
}

// CreateUser inserts a new user and returns the created row.
func (q *Querier) CreateUser(ctx context.Context, email, passwordHash, role string) (*User, error) {
	var u User
	var ph *string
	if passwordHash != "" {
		ph = &passwordHash
	}
	err := q.pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role)
		 VALUES ($1, $2, $3)
		 RETURNING id, email, password_hash, role, oauth_providers, instrument_settings, preferences, created_at, updated_at`,
		email, ph, role,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.OAuthProviders, &u.InstrumentSettings, &u.Preferences, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	return &u, nil
}

// GetUserByEmail loads a user by email address.
func (q *Querier) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := q.pool.QueryRow(ctx,
		`SELECT id, email, password_hash, role, oauth_providers, instrument_settings, preferences, created_at, updated_at
		 FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.OAuthProviders, &u.InstrumentSettings, &u.Preferences, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return &u, nil
}

// GetUserByID loads a user by UUID.
func (q *Querier) GetUserByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := q.pool.QueryRow(ctx,
		`SELECT id, email, password_hash, role, oauth_providers, instrument_settings, preferences, created_at, updated_at
		 FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.OAuthProviders, &u.InstrumentSettings, &u.Preferences, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return &u, nil
}

// UpdateUser updates a user row and returns the updated record.
func (q *Querier) UpdateUser(ctx context.Context, id, email, passwordHash, role string, oauthProviders, instrumentSettings, preferences json.RawMessage) (*User, error) {
	var u User
	var ph *string
	if passwordHash != "" {
		ph = &passwordHash
	}
	err := q.pool.QueryRow(ctx,
		`UPDATE users
		 SET email = $2, password_hash = $3, role = $4, oauth_providers = $5,
		     instrument_settings = $6, preferences = $7, updated_at = now()
		 WHERE id = $1
		 RETURNING id, email, password_hash, role, oauth_providers, instrument_settings, preferences, created_at, updated_at`,
		id, email, ph, role, oauthProviders, instrumentSettings, preferences,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.OAuthProviders, &u.InstrumentSettings, &u.Preferences, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}
	return &u, nil
}

// CountUsers returns the total number of registered users.
func (q *Querier) CountUsers(ctx context.Context) (int64, error) {
	var count int64
	err := q.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}
	return count, nil
}

// AddRememberToken stores a remember-me token for the given user email.
func (q *Querier) AddRememberToken(ctx context.Context, userEmail, token string) error {
	_, err := q.pool.Exec(ctx,
		`INSERT INTO remember_tokens (user_email, token) VALUES ($1, $2)`,
		userEmail, token,
	)
	if err != nil {
		return fmt.Errorf("add remember token: %w", err)
	}
	return nil
}

// UseRememberToken finds and deletes a specific remember-me token.
// Returns true if the token existed and was deleted, false otherwise.
func (q *Querier) UseRememberToken(ctx context.Context, userEmail, token string) (bool, error) {
	var id int64
	err := q.pool.QueryRow(ctx,
		`DELETE FROM remember_tokens WHERE user_email = $1 AND token = $2 RETURNING id`,
		userEmail, token,
	).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("use remember token: %w", err)
	}
	return true, nil
}

// DeleteRememberTokens removes all remember-me tokens for the given user email.
func (q *Querier) DeleteRememberTokens(ctx context.Context, userEmail string) error {
	_, err := q.pool.Exec(ctx,
		`DELETE FROM remember_tokens WHERE user_email = $1`,
		userEmail,
	)
	if err != nil {
		return fmt.Errorf("delete remember tokens: %w", err)
	}
	return nil
}
