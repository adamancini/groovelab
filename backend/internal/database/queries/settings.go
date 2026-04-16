package queries

import (
	"context"
	"encoding/json"
	"fmt"
)

// UserSettings holds the settings-related JSONB fields for a user.
type UserSettings struct {
	InstrumentSettings json.RawMessage `json:"instrumentSettings"`
	Preferences        json.RawMessage `json:"preferences"`
}

// GetUserSettings returns the instrument_settings and preferences for a user.
func (q *Querier) GetUserSettings(ctx context.Context, userID string) (*UserSettings, error) {
	var s UserSettings
	err := q.pool.QueryRow(ctx,
		`SELECT instrument_settings, preferences
		 FROM users WHERE id = $1`, userID,
	).Scan(&s.InstrumentSettings, &s.Preferences)
	if err != nil {
		return nil, fmt.Errorf("get user settings: %w", err)
	}
	return &s, nil
}

// UpdateUserSettings performs a JSONB merge (not replace) on instrument_settings
// and preferences. Pass nil for either to leave it unchanged.
func (q *Querier) UpdateUserSettings(ctx context.Context, userID string, instrumentSettings, preferences json.RawMessage) (*UserSettings, error) {
	var s UserSettings
	err := q.pool.QueryRow(ctx,
		`UPDATE users
		 SET instrument_settings = CASE WHEN $2::jsonb IS NOT NULL
		         THEN instrument_settings || $2::jsonb
		         ELSE instrument_settings END,
		     preferences = CASE WHEN $3::jsonb IS NOT NULL
		         THEN preferences || $3::jsonb
		         ELSE preferences END,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING instrument_settings, preferences`,
		userID, instrumentSettings, preferences,
	).Scan(&s.InstrumentSettings, &s.Preferences)
	if err != nil {
		return nil, fmt.Errorf("update user settings: %w", err)
	}
	return &s, nil
}
