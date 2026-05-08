// Package queries provides type-safe database operations for the users table.
// These types correspond to the sqlc query definitions in users.sql.
package queries

import (
	"encoding/json"
	"time"
)

// User represents a row from the users table.
type User struct {
	ID                 string          `json:"id"`
	Email              string          `json:"email"`
	PasswordHash       *string         `json:"-"`
	Role               string          `json:"role"`
	Name               *string         `json:"name"`
	Enabled            bool            `json:"enabled"`
	OAuthProviders     json.RawMessage `json:"oauth_providers"`
	InstrumentSettings json.RawMessage `json:"instrument_settings"`
	Preferences        json.RawMessage `json:"preferences"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}
