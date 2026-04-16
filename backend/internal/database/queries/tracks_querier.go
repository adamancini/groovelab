package queries

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// CreateTrack inserts a new track and returns the created row.
func (q *Querier) CreateTrack(ctx context.Context, userID, name string, chordSequence, drumPattern json.RawMessage, bpm int, playbackSettings json.RawMessage) (*Track, error) {
	var t Track
	err := q.pool.QueryRow(ctx,
		`INSERT INTO tracks (user_id, name, chord_sequence, drum_pattern, bpm, playback_settings)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at`,
		userID, name, chordSequence, drumPattern, bpm, playbackSettings,
	).Scan(&t.ID, &t.UserID, &t.Name, &t.ChordSequence, &t.DrumPattern, &t.BPM, &t.PlaybackSettings, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create track: %w", err)
	}
	return &t, nil
}

// GetTrackByID loads a track by UUID. Returns nil, nil if not found.
func (q *Querier) GetTrackByID(ctx context.Context, id string) (*Track, error) {
	var t Track
	err := q.pool.QueryRow(ctx,
		`SELECT id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at
		 FROM tracks WHERE id = $1`,
		id,
	).Scan(&t.ID, &t.UserID, &t.Name, &t.ChordSequence, &t.DrumPattern, &t.BPM, &t.PlaybackSettings, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get track by id: %w", err)
	}
	return &t, nil
}

// ListTracksByUser returns all tracks owned by the given user, ordered by updated_at DESC.
func (q *Querier) ListTracksByUser(ctx context.Context, userID string) ([]*Track, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at
		 FROM tracks
		 WHERE user_id = $1
		 ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list tracks by user: %w", err)
	}
	defer rows.Close()

	var tracks []*Track
	for rows.Next() {
		var t Track
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.ChordSequence, &t.DrumPattern, &t.BPM, &t.PlaybackSettings, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan track row: %w", err)
		}
		tracks = append(tracks, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate track rows: %w", err)
	}
	return tracks, nil
}

// ListAllTracks returns all tracks in the system (admin use), ordered by updated_at DESC.
func (q *Querier) ListAllTracks(ctx context.Context) ([]*Track, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at
		 FROM tracks
		 ORDER BY updated_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list all tracks: %w", err)
	}
	defer rows.Close()

	var tracks []*Track
	for rows.Next() {
		var t Track
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.ChordSequence, &t.DrumPattern, &t.BPM, &t.PlaybackSettings, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan track row: %w", err)
		}
		tracks = append(tracks, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate track rows: %w", err)
	}
	return tracks, nil
}

// ListAllTracksWithEmail returns all tracks joined with user email (admin use).
func (q *Querier) ListAllTracksWithEmail(ctx context.Context) ([]*AdminTrack, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT t.id, t.user_id, u.email, t.name, t.chord_sequence, t.drum_pattern, t.bpm, t.playback_settings, t.created_at, t.updated_at
		 FROM tracks t
		 JOIN users u ON t.user_id = u.id
		 ORDER BY t.updated_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list all tracks with email: %w", err)
	}
	defer rows.Close()

	var tracks []*AdminTrack
	for rows.Next() {
		var t AdminTrack
		if err := rows.Scan(&t.ID, &t.UserID, &t.UserEmail, &t.Name, &t.ChordSequence, &t.DrumPattern, &t.BPM, &t.PlaybackSettings, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan admin track row: %w", err)
		}
		tracks = append(tracks, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin track rows: %w", err)
	}
	return tracks, nil
}

// UpdateTrack updates a track and returns the updated row.
func (q *Querier) UpdateTrack(ctx context.Context, id, name string, chordSequence, drumPattern json.RawMessage, bpm int, playbackSettings json.RawMessage) (*Track, error) {
	var t Track
	err := q.pool.QueryRow(ctx,
		`UPDATE tracks
		 SET name = $2,
		     chord_sequence = $3,
		     drum_pattern = $4,
		     bpm = $5,
		     playback_settings = $6,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at`,
		id, name, chordSequence, drumPattern, bpm, playbackSettings,
	).Scan(&t.ID, &t.UserID, &t.Name, &t.ChordSequence, &t.DrumPattern, &t.BPM, &t.PlaybackSettings, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("update track: %w", err)
	}
	return &t, nil
}

// DeleteTrack deletes a track by ID. Returns true if the track was deleted, false if not found.
func (q *Querier) DeleteTrack(ctx context.Context, id string) (bool, error) {
	tag, err := q.pool.Exec(ctx, `DELETE FROM tracks WHERE id = $1`, id)
	if err != nil {
		return false, fmt.Errorf("delete track: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// UpsertStreak inserts or updates a streak row for the given user and date.
// On conflict, session_correct_streak is replaced and session_best_streak
// is set to the greater of the existing and new value.
func (q *Querier) UpsertStreak(ctx context.Context, userID string, practiceDate time.Time, sessionCorrectStreak, sessionBestStreak int) (*Streak, error) {
	var s Streak
	err := q.pool.QueryRow(ctx,
		`INSERT INTO streaks (user_id, practice_date, session_correct_streak, session_best_streak)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, practice_date)
		 DO UPDATE SET
		     session_correct_streak = $3,
		     session_best_streak = GREATEST(streaks.session_best_streak, $4)
		 RETURNING id, user_id, practice_date, session_correct_streak, session_best_streak`,
		userID, practiceDate, sessionCorrectStreak, sessionBestStreak,
	).Scan(&s.ID, &s.UserID, &s.PracticeDate, &s.SessionCorrectStreak, &s.SessionBestStreak)
	if err != nil {
		return nil, fmt.Errorf("upsert streak: %w", err)
	}
	return &s, nil
}

// GetStreaksByUser returns all streak rows for a user, ordered by practice_date DESC.
func (q *Querier) GetStreaksByUser(ctx context.Context, userID string) ([]*Streak, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT id, user_id, practice_date, session_correct_streak, session_best_streak
		 FROM streaks
		 WHERE user_id = $1
		 ORDER BY practice_date DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get streaks by user: %w", err)
	}
	defer rows.Close()

	var streaks []*Streak
	for rows.Next() {
		var s Streak
		if err := rows.Scan(&s.ID, &s.UserID, &s.PracticeDate, &s.SessionCorrectStreak, &s.SessionBestStreak); err != nil {
			return nil, fmt.Errorf("scan streak row: %w", err)
		}
		streaks = append(streaks, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate streak rows: %w", err)
	}
	return streaks, nil
}

// GetStreakByDate loads a single streak row for a user and date.
func (q *Querier) GetStreakByDate(ctx context.Context, userID string, practiceDate time.Time) (*Streak, error) {
	var s Streak
	err := q.pool.QueryRow(ctx,
		`SELECT id, user_id, practice_date, session_correct_streak, session_best_streak
		 FROM streaks
		 WHERE user_id = $1 AND practice_date = $2`,
		userID, practiceDate,
	).Scan(&s.ID, &s.UserID, &s.PracticeDate, &s.SessionCorrectStreak, &s.SessionBestStreak)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get streak by date: %w", err)
	}
	return &s, nil
}

// GetDailyStreakCount returns the current consecutive-day streak count for a user.
func (q *Querier) GetDailyStreakCount(ctx context.Context, userID string) (int, error) {
	var count int
	err := q.pool.QueryRow(ctx,
		`WITH RECURSIVE streak_chain AS (
		    SELECT practice_date, 1 AS streak_length
		    FROM streaks
		    WHERE user_id = $1
		    AND practice_date = (SELECT MAX(practice_date) FROM streaks WHERE user_id = $1)

		    UNION ALL

		    SELECT s.practice_date, sc.streak_length + 1
		    FROM streaks s
		    JOIN streak_chain sc ON s.practice_date = sc.practice_date - INTERVAL '1 day'
		    WHERE s.user_id = $1
		)
		SELECT COALESCE(MAX(streak_length), 0)::int AS current_streak
		FROM streak_chain`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("get daily streak count: %w", err)
	}
	return count, nil
}

// GetBestDailyStreak returns the longest consecutive-day streak for a user.
func (q *Querier) GetBestDailyStreak(ctx context.Context, userID string) (int, error) {
	var best int
	err := q.pool.QueryRow(ctx,
		`WITH practice_gaps AS (
		    SELECT practice_date,
		           practice_date - (ROW_NUMBER() OVER (ORDER BY practice_date))::int AS grp
		    FROM streaks
		    WHERE user_id = $1
		),
		streak_groups AS (
		    SELECT grp, COUNT(*) AS streak_length
		    FROM practice_gaps
		    GROUP BY grp
		)
		SELECT COALESCE(MAX(streak_length), 0)::int AS best_streak
		FROM streak_groups`,
		userID,
	).Scan(&best)
	if err != nil {
		return 0, fmt.Errorf("get best daily streak: %w", err)
	}
	return best, nil
}
