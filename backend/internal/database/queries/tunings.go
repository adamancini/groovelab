package queries

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// TuningPreset represents a row from the tuning_presets table.
type TuningPreset struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	StringCount int             `json:"stringCount"`
	Pitches     json.RawMessage `json:"pitches"`
	IsDefault   bool            `json:"isDefault"`
}

// ListTuningPresets returns all tuning presets.
func (q *Querier) ListTuningPresets(ctx context.Context) ([]TuningPreset, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT id, name, string_count, pitches, is_default
		 FROM tuning_presets
		 ORDER BY string_count, name`)
	if err != nil {
		return nil, fmt.Errorf("list tuning presets: %w", err)
	}
	defer rows.Close()
	return scanTuningPresets(rows)
}

// ListTuningPresetsByStringCount returns tuning presets filtered by string count.
func (q *Querier) ListTuningPresetsByStringCount(ctx context.Context, stringCount int) ([]TuningPreset, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT id, name, string_count, pitches, is_default
		 FROM tuning_presets
		 WHERE string_count = $1
		 ORDER BY name`, stringCount)
	if err != nil {
		return nil, fmt.Errorf("list tuning presets by string count: %w", err)
	}
	defer rows.Close()
	return scanTuningPresets(rows)
}

// GetTuningPresetByID loads a single tuning preset by UUID.
// Returns nil if not found.
func (q *Querier) GetTuningPresetByID(ctx context.Context, id string) (*TuningPreset, error) {
	var tp TuningPreset
	err := q.pool.QueryRow(ctx,
		`SELECT id, name, string_count, pitches, is_default
		 FROM tuning_presets WHERE id = $1`, id,
	).Scan(&tp.ID, &tp.Name, &tp.StringCount, &tp.Pitches, &tp.IsDefault)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get tuning preset by id: %w", err)
	}
	return &tp, nil
}

// scanTuningPresets scans all rows into a slice of TuningPreset.
func scanTuningPresets(rows pgx.Rows) ([]TuningPreset, error) {
	var presets []TuningPreset
	for rows.Next() {
		var tp TuningPreset
		if err := rows.Scan(&tp.ID, &tp.Name, &tp.StringCount, &tp.Pitches, &tp.IsDefault); err != nil {
			return nil, fmt.Errorf("scan tuning preset: %w", err)
		}
		presets = append(presets, tp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tuning preset rows: %w", err)
	}
	return presets, nil
}
