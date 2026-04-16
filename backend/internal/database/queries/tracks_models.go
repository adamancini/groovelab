package queries

import (
	"encoding/json"
	"time"
)

// Track represents a row from the tracks table.
type Track struct {
	ID               string          `json:"id"`
	UserID           string          `json:"user_id"`
	Name             string          `json:"name"`
	ChordSequence    json.RawMessage `json:"chord_sequence"`
	DrumPattern      json.RawMessage `json:"drum_pattern"`
	BPM              int             `json:"bpm"`
	PlaybackSettings json.RawMessage `json:"playback_settings"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// AdminTrack extends Track with the owning user's email for admin listings.
type AdminTrack struct {
	ID               string          `json:"id"`
	UserID           string          `json:"user_id"`
	UserEmail        string          `json:"user_email"`
	Name             string          `json:"name"`
	ChordSequence    json.RawMessage `json:"chord_sequence"`
	DrumPattern      json.RawMessage `json:"drum_pattern"`
	BPM              int             `json:"bpm"`
	PlaybackSettings json.RawMessage `json:"playback_settings"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// Streak represents a row from the streaks table.
type Streak struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	PracticeDate         time.Time `json:"practice_date"`
	SessionCorrectStreak int       `json:"session_correct_streak"`
	SessionBestStreak    int       `json:"session_best_streak"`
}
