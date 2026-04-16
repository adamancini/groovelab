// Package fretboard provides HTTP handlers for fretboard reference data,
// including tuning presets.
package fretboard

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler serves fretboard-related API endpoints.
type Handler struct {
	queries *queries.Querier
}

// NewHandler creates a fretboard handler backed by the given connection pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{queries: queries.New(pool)}
}

// ListTunings handles GET /api/v1/fretboard/tunings.
// Optional query parameter: ?string_count=N
func (h *Handler) ListTunings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var (
		presets []queries.TuningPreset
		err     error
	)

	if sc := r.URL.Query().Get("string_count"); sc != "" {
		n, parseErr := strconv.Atoi(sc)
		if parseErr != nil || n < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "string_count must be a positive integer",
			})
			return
		}
		presets, err = h.queries.ListTuningPresetsByStringCount(ctx, n)
	} else {
		presets, err = h.queries.ListTuningPresets(ctx)
	}

	if err != nil {
		log.Printf("error listing tuning presets: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to list tuning presets",
		})
		return
	}

	// Return empty array instead of null when no presets found.
	if presets == nil {
		presets = []queries.TuningPreset{}
	}

	writeJSON(w, http.StatusOK, presets)
}

// writeJSON encodes v as JSON and writes it to w with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("error encoding json response: %v", err)
	}
}
