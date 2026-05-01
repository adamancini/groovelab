// Package flashcards implements the adaptive flashcard engine for music theory
// drilling. It provides card selection, answer submission, mastery tracking,
// and session management.
package flashcards

import (
	"encoding/json"
	"time"
)

// Card represents a single flashcard from the cards table.
type Card struct {
	ID           string          `json:"id"`
	Topic        string          `json:"topic"`
	Direction    string          `json:"direction"`
	KeySignature string          `json:"key_signature"`
	ChordType    *string         `json:"chord_type,omitempty"`
	Question     json.RawMessage `json:"question"`
	CorrectAnswer json.RawMessage `json:"correct_answer"`
	Distractors  json.RawMessage `json:"distractors"`
}

// Attempt represents a single answer submission from the attempts table.
type Attempt struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	CardID         string    `json:"card_id"`
	Correct        bool      `json:"correct"`
	InputMethod    string    `json:"input_method"`
	ResponseTimeMs *int      `json:"response_time_ms,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// Mastery tracks per-user, per-card learning progress from the mastery table.
type Mastery struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	CardID            string     `json:"card_id"`
	Stage             int        `json:"stage"`
	ConsecutiveCorrect int       `json:"consecutive_correct"`
	ConsecutiveWrong  int        `json:"consecutive_wrong"`
	Accuracy          float64    `json:"accuracy"`
	TotalAttempts     int        `json:"total_attempts"`
	LastPracticed     *time.Time `json:"last_practiced,omitempty"`
}

// TopicSummary describes a topic with optional mastery information.
type TopicSummary struct {
	Topic         string   `json:"topic"`
	CardCount     int      `json:"card_count"`
	MasteryPct    *float64 `json:"mastery_pct,omitempty"`
	PracticedCount *int    `json:"practiced_count,omitempty"`
}

// SessionCard is a card presented during a session, with metadata about
// the number of distractor options based on the user's mastery stage.
type SessionCard struct {
	Card
	Stage      int    `json:"stage"`
	Options    int    `json:"options"`
	BucketHint string `json:"bucket_hint,omitempty"`
}

// AnswerRequest is the JSON body for POST /api/v1/flashcards/answer.
type AnswerRequest struct {
	CardID       string `json:"card_id"`
	Answer       json.RawMessage `json:"answer"`
	InputMethod  string `json:"input_method"`
	ResponseTimeMs *int `json:"response_time_ms,omitempty"`
}

// AnswerResponse is the JSON response from POST /api/v1/flashcards/answer.
type AnswerResponse struct {
	Correct          bool                `json:"correct"`
	CorrectAnswer    json.RawMessage     `json:"correct_answer"`
	Explanation      string              `json:"explanation"`
	NextCard         *SessionCard        `json:"next_card,omitempty"`
	SessionProgress  SessionProgress     `json:"session_progress"`
	// CorrectPositions is the canonical voicing for a chord-quality card,
	// emitted so the frontend AnswerFeedback's `feedback-fretboard` mini
	// board can render the correct shape on the wrong-answer teaching
	// surface. Omitted entirely (omitempty) for non-chord cards (e.g.
	// type_to_intervals). The wire shape mirrors the frontend
	// FretboardPosition interface in frontend/src/lib/api.ts. See GRO-gq31.
	CorrectPositions []FretboardPosition `json:"correct_positions,omitempty"`
}

// FretboardPosition is a single position on the fretboard, used to convey the
// canonical voicing of a chord answer to the frontend. Wire shape matches the
// frontend FretboardPosition TS type:
//
//	{ "string": <int>, "fret": <int>, "label": <string?> }
//
// `string` is the 0-indexed string number (string 0 is the highest-pitched
// string). `fret` is 0-indexed (0 = open). `label` is the chord-tone name
// (e.g. "C", "E", "G"). The label is informational; the frontend renders the
// fret position regardless.
type FretboardPosition struct {
	String int    `json:"string"`
	Fret   int    `json:"fret"`
	Label  string `json:"label,omitempty"`
}

// SessionProgress describes how far along a session the user is.
type SessionProgress struct {
	Answered  int `json:"answered"`
	Total     int `json:"total"`
	Correct   int `json:"correct"`
	Incorrect int `json:"incorrect"`
}

// SessionResponse is the JSON response from GET /api/v1/flashcards/session.
type SessionResponse struct {
	SessionID string        `json:"session_id"`
	Topic     string        `json:"topic"`
	Cards     []SessionCard `json:"cards"`
	Total     int           `json:"total"`
}

// Bucket categorizes a card's mastery state for adaptive selection.
type Bucket int

const (
	// BucketNew is for cards the user has never practiced.
	BucketNew Bucket = iota
	// BucketStruggling is for cards with low accuracy or consecutive failures.
	BucketStruggling
	// BucketReview is for cards due for review based on last_practiced time.
	BucketReview
	// BucketMastered is for cards at stage 3 with high accuracy.
	BucketMastered
)

// String returns a human-readable label for the bucket.
func (b Bucket) String() string {
	switch b {
	case BucketNew:
		return "new"
	case BucketStruggling:
		return "struggling"
	case BucketReview:
		return "review"
	case BucketMastered:
		return "mastered"
	default:
		return "unknown"
	}
}
