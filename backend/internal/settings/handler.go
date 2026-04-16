// Package settings provides HTTP handlers for user instrument settings
// and preferences.
package settings

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"

	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aarondl/authboss/v3"
)

// pitchPattern validates scientific pitch notation (e.g., "E1", "Eb1", "Ab2", "Bb0").
// Accepts note letters A-G, optional sharp (#) or flat (b), and octave digit 0-9.
var pitchPattern = regexp.MustCompile(`^[A-G][b#]?\d$`)

// Handler serves user settings API endpoints.
type Handler struct {
	queries *queries.Querier
	ab      *authboss.Authboss
}

// NewHandler creates a settings handler.
func NewHandler(pool *pgxpool.Pool, ab *authboss.Authboss) *Handler {
	return &Handler{
		queries: queries.New(pool),
		ab:      ab,
	}
}

// GetSettings handles GET /api/v1/settings.
// Returns the current user's instrument_settings and preferences.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.currentUserID(w, r)
	if !ok {
		return
	}

	settings, err := h.queries.GetUserSettings(r.Context(), userID)
	if err != nil {
		log.Printf("error getting user settings: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to get user settings",
		})
		return
	}

	writeJSON(w, http.StatusOK, settings)
}

// settingsUpdateRequest represents the JSON body for PUT /api/v1/settings.
type settingsUpdateRequest struct {
	InstrumentSettings json.RawMessage `json:"instrumentSettings"`
	Preferences        json.RawMessage `json:"preferences"`
}

// instrumentSettingsPayload represents fields we need to validate inside
// instrumentSettings.
type instrumentSettingsPayload struct {
	TuningPresetID *string  `json:"tuningPresetId"`
	CustomTuning   []string `json:"customTuning"`
	StringCount    *int     `json:"stringCount"`
}

// UpdateSettings handles PUT /api/v1/settings.
// Performs JSONB merge (not replace) on instrument_settings and preferences.
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.currentUserID(w, r)
	if !ok {
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "failed to read request body",
		})
		return
	}

	var req settingsUpdateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid JSON",
		})
		return
	}

	// Validate instrument settings if present.
	if req.InstrumentSettings != nil && len(req.InstrumentSettings) > 0 {
		var isp instrumentSettingsPayload
		if err := json.Unmarshal(req.InstrumentSettings, &isp); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "invalid instrumentSettings JSON",
			})
			return
		}

		// Validate tuningPresetId if provided.
		if isp.TuningPresetID != nil && *isp.TuningPresetID != "" {
			preset, err := h.queries.GetTuningPresetByID(r.Context(), *isp.TuningPresetID)
			if err != nil {
				log.Printf("error checking tuning preset: %v", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{
					"error": "failed to validate tuning preset",
				})
				return
			}
			if preset == nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "tuningPresetId does not exist",
				})
				return
			}
		}

		// Validate customTuning if provided (non-null).
		if isp.CustomTuning != nil {
			// Determine expected string count.
			stringCount := 0
			if isp.StringCount != nil {
				stringCount = *isp.StringCount
			} else {
				// If stringCount is not in this update, get current settings
				// to determine it.
				current, err := h.queries.GetUserSettings(r.Context(), userID)
				if err != nil {
					log.Printf("error reading current settings: %v", err)
					writeJSON(w, http.StatusInternalServerError, map[string]string{
						"error": "failed to validate custom tuning",
					})
					return
				}
				var currentIS instrumentSettingsPayload
				if current.InstrumentSettings != nil {
					_ = json.Unmarshal(current.InstrumentSettings, &currentIS)
				}
				if currentIS.StringCount != nil {
					stringCount = *currentIS.StringCount
				}
			}

			if stringCount > 0 && len(isp.CustomTuning) != stringCount {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "customTuning length must match stringCount",
				})
				return
			}

			for _, pitch := range isp.CustomTuning {
				if !pitchPattern.MatchString(pitch) {
					writeJSON(w, http.StatusBadRequest, map[string]string{
						"error": "customTuning contains invalid pitch name: " + pitch,
					})
					return
				}
			}
		}
	}

	updated, err := h.queries.UpdateUserSettings(r.Context(), userID, req.InstrumentSettings, req.Preferences)
	if err != nil {
		log.Printf("error updating user settings: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to update settings",
		})
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// currentUserID extracts the authenticated user's ID from the request context.
// Writes a 401 response and returns false if no user is authenticated.
func (h *Handler) currentUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, err := h.ab.LoadCurrentUser(&r)
	if err != nil || user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "authentication required",
		})
		return "", false
	}

	// The user should be an auth.ABUser wrapping a queries.User with an ID.
	type pidGetter interface {
		GetPID() string
	}

	type idGetter interface {
		UserID() string
	}

	// Try the direct ID approach first via interface.
	if ig, ok := user.(idGetter); ok {
		return ig.UserID(), true
	}

	// Fall back: load user by PID (email) from the database.
	pid := user.(pidGetter).GetPID()
	dbUser, err := h.queries.GetUserByEmail(r.Context(), pid)
	if err != nil || dbUser == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to load user",
		})
		return "", false
	}
	return dbUser.ID, true
}

// writeJSON encodes v as JSON and writes it to w with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("error encoding json response: %v", err)
	}
}
