package flashcards

import (
	"encoding/json"
	"math/rand/v2"
	"time"
)

// SessionSize is the default number of cards in a session.
const SessionSize = 20

// MaxNewPerSession limits how many new cards are introduced per session.
const MaxNewPerSession = 3

// Adaptive selection distribution targets (fractions of SessionSize).
const (
	StrugglingPct = 0.40
	ReviewPct     = 0.30
	NewPct        = 0.20
	MasteredPct   = 0.10
)

// ReviewThreshold is the minimum time since last practice before a card is
// eligible for review rather than being considered recently practiced.
const ReviewThreshold = 4 * time.Hour

// StageAdvanceThreshold is how many consecutive correct answers are needed
// to advance to the next mastery stage.
const StageAdvanceThreshold = 3

// StageRegressThreshold is how many consecutive wrong answers cause a
// regression to the previous mastery stage.
const StageRegressThreshold = 2

// MaxStage is the highest mastery stage (fretboard tap).
const MaxStage = 3

// OptionsForStage returns the number of multiple-choice options for a given
// mastery stage. Stages 2+ use free-form input (0 options).
func OptionsForStage(stage int) int {
	switch {
	case stage <= 0:
		return 4
	case stage == 1:
		return 3
	default:
		return 0 // typed or fretboard
	}
}

// ClassifyCard assigns a card to an adaptive bucket based on its mastery record.
// If mastery is nil, the card is New.
func ClassifyCard(m *Mastery) Bucket {
	if m == nil {
		return BucketNew
	}
	// Mastered: stage 3 with accuracy > 90%.
	if m.Stage >= MaxStage && m.Accuracy > 0.90 {
		return BucketMastered
	}
	// Struggling: accuracy < 50% or 2+ consecutive wrong.
	if m.Accuracy < 0.50 || m.ConsecutiveWrong >= StageRegressThreshold {
		return BucketStruggling
	}
	// Review: has been practiced but is not struggling or mastered.
	return BucketReview
}

// BuildSession selects cards for an adaptive practice session.
// cards is the full set of cards for the topic; masteryMap maps card_id to Mastery.
// maxCards caps the number of returned cards; pass 0 (or negative) to use the
// SessionSize default. Wired from KOTS Config item "max_cards_per_session"
// via the MAX_CARDS_PER_SESSION env var. See GRO-7uiw.
// Returns up to SessionSize (or maxCards) cards distributed across the four buckets.
func BuildSession(cards []Card, masteryMap map[string]*Mastery, maxCards int) []SessionCard {
	buckets := map[Bucket][]Card{
		BucketNew:        {},
		BucketStruggling: {},
		BucketReview:     {},
		BucketMastered:   {},
	}

	for _, c := range cards {
		m := masteryMap[c.ID]
		b := ClassifyCard(m)
		buckets[b] = append(buckets[b], c)
	}

	// Shuffle each bucket.
	for b := range buckets {
		rand.Shuffle(len(buckets[b]), func(i, j int) {
			buckets[b][i], buckets[b][j] = buckets[b][j], buckets[b][i]
		})
	}

	// Target counts for each bucket.
	targets := map[Bucket]int{
		BucketStruggling: int(float64(SessionSize) * StrugglingPct), // 8
		BucketReview:     int(float64(SessionSize) * ReviewPct),     // 6
		BucketNew:        int(float64(SessionSize) * NewPct),        // 4, capped at MaxNewPerSession
		BucketMastered:   int(float64(SessionSize) * MasteredPct),   // 2
	}

	// Cap new cards.
	if targets[BucketNew] > MaxNewPerSession {
		targets[BucketNew] = MaxNewPerSession
	}

	var session []SessionCard
	remaining := SessionSize

	// Fill from each bucket in priority order: struggling, review, new, mastered.
	for _, b := range []Bucket{BucketStruggling, BucketReview, BucketNew, BucketMastered} {
		target := targets[b]
		if target > remaining {
			target = remaining
		}
		available := buckets[b]
		if target > len(available) {
			target = len(available)
		}
		for i := 0; i < target; i++ {
			sc := cardToSession(available[i], masteryMap[available[i].ID], b)
			session = append(session, sc)
			remaining--
		}
	}

	// If we have fewer than SessionSize, backfill from buckets that have surplus.
	// Skip BucketNew during backfill to respect MaxNewPerSession cap.
	if remaining > 0 {
		for _, b := range []Bucket{BucketReview, BucketStruggling, BucketMastered} {
			available := buckets[b]
			alreadyUsed := targets[b]
			if alreadyUsed > len(available) {
				alreadyUsed = len(available)
			}
			for i := alreadyUsed; i < len(available) && remaining > 0; i++ {
				sc := cardToSession(available[i], masteryMap[available[i].ID], b)
				session = append(session, sc)
				remaining--
			}
		}
	}

	// Final shuffle so the user does not see grouped buckets.
	rand.Shuffle(len(session), func(i, j int) {
		session[i], session[j] = session[j], session[i]
	})

	// Apply maxCards cap if specified (KOTS Config: max_cards_per_session).
	if maxCards > 0 && len(session) > maxCards {
		session = session[:maxCards]
	}

	return session
}

// cardToSession converts a Card and optional Mastery into a SessionCard.
func cardToSession(c Card, m *Mastery, bucket Bucket) SessionCard {
	stage := 0
	if m != nil {
		stage = m.Stage
	}
	return SessionCard{
		Card:       c,
		Stage:      stage,
		Options:    OptionsForStage(stage),
		BucketHint: bucket.String(),
	}
}

// ProcessAnswer evaluates an answer against the card's correct answer and
// updates the mastery record accordingly. It returns whether the answer was correct.
// For in-memory (guest) mastery, the caller should pass a non-nil Mastery that is
// not persisted to the database.
func ProcessAnswer(m *Mastery, card *Card, answer json.RawMessage) bool {
	correct := checkAnswer(card.CorrectAnswer, answer)

	m.TotalAttempts++

	if correct {
		m.ConsecutiveCorrect++
		m.ConsecutiveWrong = 0
		// Advance stage if threshold met (max stage 3).
		if m.ConsecutiveCorrect >= StageAdvanceThreshold && m.Stage < MaxStage {
			m.Stage++
			m.ConsecutiveCorrect = 0
		}
	} else {
		m.ConsecutiveWrong++
		m.ConsecutiveCorrect = 0
		// Regress stage if threshold met (min stage 0).
		if m.ConsecutiveWrong >= StageRegressThreshold && m.Stage > 0 {
			m.Stage--
			m.ConsecutiveWrong = 0
		}
	}

	// Recalculate rolling accuracy.
	if m.TotalAttempts > 0 {
		correctCount := m.Accuracy*float64(m.TotalAttempts-1) + boolToFloat(correct)
		m.Accuracy = correctCount / float64(m.TotalAttempts)
	}

	now := time.Now()
	m.LastPracticed = &now

	return correct
}

// checkAnswer compares the submitted answer with the correct answer.
// It normalizes both to JSON and performs a deep comparison. A simple
// string equality check on the "name" or "notes" field is used as a
// pragmatic first pass.
func checkAnswer(correctAnswer, submittedAnswer json.RawMessage) bool {
	// Try to extract and compare "name" fields (most common case).
	var correct, submitted map[string]interface{}
	if err := json.Unmarshal(correctAnswer, &correct); err != nil {
		return false
	}
	if err := json.Unmarshal(submittedAnswer, &submitted); err != nil {
		return false
	}

	// Compare "intervals" field first: type_to_intervals cards use this
	// axis and both "name" and "intervals" may be present on the correct
	// answer. Checking intervals first ensures we compare the field the
	// UI actually submits. Non-interval cards omit this field, so the
	// block is a no-op for them.
	if ci, ok := correct["intervals"]; ok {
		if si, ok := submitted["intervals"]; ok {
			return ci == si
		}
	}

	// Compare "name" field if present in both.
	if cn, ok := correct["name"]; ok {
		if sn, ok := submitted["name"]; ok {
			return cn == sn
		}
	}

	// Compare "notes" field if present in both.
	if cn, ok := correct["notes"]; ok {
		if sn, ok := submitted["notes"]; ok {
			return cn == sn
		}
	}

	// Fallback: byte-level comparison of the raw JSON.
	return string(correctAnswer) == string(submittedAnswer)
}

func boolToFloat(b bool) float64 {
	if b {
		return 1.0
	}
	return 0.0
}
