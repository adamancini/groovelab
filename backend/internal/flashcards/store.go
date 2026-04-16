package flashcards

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store executes database queries for the flashcard engine.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by the given connection pool.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// ListCardsByTopic returns all cards for the given topic.
func (s *Store) ListCardsByTopic(ctx context.Context, topic string) ([]Card, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, topic, direction, key_signature, chord_type, question, correct_answer, distractors
		 FROM cards WHERE topic = $1
		 ORDER BY key_signature, direction`,
		topic,
	)
	if err != nil {
		return nil, fmt.Errorf("list cards by topic: %w", err)
	}
	defer rows.Close()

	var cards []Card
	for rows.Next() {
		var c Card
		if err := rows.Scan(&c.ID, &c.Topic, &c.Direction, &c.KeySignature, &c.ChordType,
			&c.Question, &c.CorrectAnswer, &c.Distractors); err != nil {
			return nil, fmt.Errorf("scan card: %w", err)
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}

// GetCardByID returns a single card by its UUID.
func (s *Store) GetCardByID(ctx context.Context, cardID string) (*Card, error) {
	var c Card
	err := s.pool.QueryRow(ctx,
		`SELECT id, topic, direction, key_signature, chord_type, question, correct_answer, distractors
		 FROM cards WHERE id = $1`,
		cardID,
	).Scan(&c.ID, &c.Topic, &c.Direction, &c.KeySignature, &c.ChordType,
		&c.Question, &c.CorrectAnswer, &c.Distractors)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get card by id: %w", err)
	}
	return &c, nil
}

// GetMasteryForUser returns all mastery records for a user within a given topic.
func (s *Store) GetMasteryForUser(ctx context.Context, userID, topic string) ([]Mastery, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT m.id, m.user_id, m.card_id, m.stage, m.consecutive_correct,
		        m.consecutive_wrong, m.accuracy, m.total_attempts, m.last_practiced
		 FROM mastery m
		 JOIN cards c ON c.id = m.card_id
		 WHERE m.user_id = $1 AND c.topic = $2`,
		userID, topic,
	)
	if err != nil {
		return nil, fmt.Errorf("get mastery for user: %w", err)
	}
	defer rows.Close()

	var records []Mastery
	for rows.Next() {
		var m Mastery
		if err := rows.Scan(&m.ID, &m.UserID, &m.CardID, &m.Stage, &m.ConsecutiveCorrect,
			&m.ConsecutiveWrong, &m.Accuracy, &m.TotalAttempts, &m.LastPracticed); err != nil {
			return nil, fmt.Errorf("scan mastery: %w", err)
		}
		records = append(records, m)
	}
	return records, rows.Err()
}

// GetMasteryByUserAndCard returns the mastery record for a specific user+card pair.
func (s *Store) GetMasteryByUserAndCard(ctx context.Context, userID, cardID string) (*Mastery, error) {
	var m Mastery
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, card_id, stage, consecutive_correct, consecutive_wrong,
		        accuracy, total_attempts, last_practiced
		 FROM mastery WHERE user_id = $1 AND card_id = $2`,
		userID, cardID,
	).Scan(&m.ID, &m.UserID, &m.CardID, &m.Stage, &m.ConsecutiveCorrect,
		&m.ConsecutiveWrong, &m.Accuracy, &m.TotalAttempts, &m.LastPracticed)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get mastery by user and card: %w", err)
	}
	return &m, nil
}

// UpsertMastery inserts or updates a mastery record for the given user+card pair.
func (s *Store) UpsertMastery(ctx context.Context, m *Mastery) error {
	now := time.Now()
	m.LastPracticed = &now

	_, err := s.pool.Exec(ctx,
		`INSERT INTO mastery (user_id, card_id, stage, consecutive_correct, consecutive_wrong,
		                      accuracy, total_attempts, last_practiced)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (user_id, card_id)
		 DO UPDATE SET stage = $3, consecutive_correct = $4, consecutive_wrong = $5,
		              accuracy = $6, total_attempts = $7, last_practiced = $8`,
		m.UserID, m.CardID, m.Stage, m.ConsecutiveCorrect, m.ConsecutiveWrong,
		m.Accuracy, m.TotalAttempts, m.LastPracticed,
	)
	if err != nil {
		return fmt.Errorf("upsert mastery: %w", err)
	}
	return nil
}

// RecordAttempt inserts a row into the attempts table (append-only).
func (s *Store) RecordAttempt(ctx context.Context, a *Attempt) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO attempts (user_id, card_id, correct, input_method, response_time_ms)
		 VALUES ($1, $2, $3, $4, $5)`,
		a.UserID, a.CardID, a.Correct, a.InputMethod, a.ResponseTimeMs,
	)
	if err != nil {
		return fmt.Errorf("record attempt: %w", err)
	}
	return nil
}

// GetTopicSummaries returns all distinct topics with card counts.
func (s *Store) GetTopicSummaries(ctx context.Context) ([]TopicSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT topic, COUNT(*) AS card_count
		 FROM cards
		 GROUP BY topic
		 ORDER BY topic`,
	)
	if err != nil {
		return nil, fmt.Errorf("get topic summaries: %w", err)
	}
	defer rows.Close()

	var summaries []TopicSummary
	for rows.Next() {
		var ts TopicSummary
		if err := rows.Scan(&ts.Topic, &ts.CardCount); err != nil {
			return nil, fmt.Errorf("scan topic summary: %w", err)
		}
		summaries = append(summaries, ts)
	}
	return summaries, rows.Err()
}

// GetTopicMasteryForUser returns topic summaries enriched with mastery data
// for the given user.
func (s *Store) GetTopicMasteryForUser(ctx context.Context, userID string) ([]TopicSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT c.topic,
		        COUNT(DISTINCT c.id) AS card_count,
		        COUNT(DISTINCT m.card_id) AS practiced_count,
		        COALESCE(AVG(m.accuracy) FILTER (WHERE m.total_attempts > 0), 0) AS mastery_pct
		 FROM cards c
		 LEFT JOIN mastery m ON m.card_id = c.id AND m.user_id = $1
		 GROUP BY c.topic
		 ORDER BY c.topic`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get topic mastery for user: %w", err)
	}
	defer rows.Close()

	var summaries []TopicSummary
	for rows.Next() {
		var ts TopicSummary
		var practicedCount int
		var masteryPct float64
		if err := rows.Scan(&ts.Topic, &ts.CardCount, &practicedCount, &masteryPct); err != nil {
			return nil, fmt.Errorf("scan topic mastery: %w", err)
		}
		ts.PracticedCount = &practicedCount
		ts.MasteryPct = &masteryPct
		summaries = append(summaries, ts)
	}
	return summaries, rows.Err()
}

// CountCards returns the total number of cards in the database.
func (s *Store) CountCards(ctx context.Context) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM cards`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count cards: %w", err)
	}
	return count, nil
}

// ListDistinctTopics returns all unique topic values from the cards table.
func (s *Store) ListDistinctTopics(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT topic FROM cards ORDER BY topic`)
	if err != nil {
		return nil, fmt.Errorf("list distinct topics: %w", err)
	}
	defer rows.Close()

	var topics []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("scan topic: %w", err)
		}
		topics = append(topics, t)
	}
	return topics, rows.Err()
}
