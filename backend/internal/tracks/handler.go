// Package tracks provides HTTP handlers for practice track CRUD operations.
package tracks

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/aarondl/authboss/v3"
	grooveauth "github.com/adamancini/groovelab/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds dependencies for track CRUD handlers.
type Handler struct {
	queries *queries.Querier
	ab      *authboss.Authboss
}

// NewHandler creates a new track handler.
func NewHandler(pool *pgxpool.Pool, ab *authboss.Authboss) *Handler {
	return &Handler{
		queries: queries.New(pool),
		ab:      ab,
	}
}

// createTrackRequest is the JSON body for POST /api/v1/tracks.
type createTrackRequest struct {
	Name             string          `json:"name"`
	ChordSequence    json.RawMessage `json:"chord_sequence"`
	DrumPattern      json.RawMessage `json:"drum_pattern"`
	BPM              int             `json:"bpm"`
	PlaybackSettings json.RawMessage `json:"playback_settings"`
}

// updateTrackRequest is the JSON body for PUT /api/v1/tracks/:id.
type updateTrackRequest struct {
	Name             string          `json:"name"`
	ChordSequence    json.RawMessage `json:"chord_sequence"`
	DrumPattern      json.RawMessage `json:"drum_pattern"`
	BPM              int             `json:"bpm"`
	PlaybackSettings json.RawMessage `json:"playback_settings"`
}

// currentUserID extracts the authenticated user's ID from the request context.
func (h *Handler) currentUserID(r *http.Request) (string, error) {
	user, err := h.ab.LoadCurrentUser(&r)
	if err != nil || user == nil {
		return "", err
	}
	abu, ok := user.(*grooveauth.ABUser)
	if !ok || abu.DBUser == nil {
		return "", nil
	}
	return abu.DBUser.ID, nil
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("error encoding JSON response: %v", err)
	}
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// List handles GET /api/v1/tracks -- returns only the authenticated user's tracks.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	tracks, err := h.queries.ListTracksByUser(r.Context(), userID)
	if err != nil {
		log.Printf("error listing tracks: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to list tracks")
		return
	}

	if tracks == nil {
		tracks = []*queries.Track{}
	}
	writeJSON(w, http.StatusOK, tracks)
}

// ListAll handles GET /api/v1/admin/tracks -- returns all tracks (admin only).
func (h *Handler) ListAll(w http.ResponseWriter, r *http.Request) {
	tracks, err := h.queries.ListAllTracks(r.Context())
	if err != nil {
		log.Printf("error listing all tracks: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to list tracks")
		return
	}

	if tracks == nil {
		tracks = []*queries.Track{}
	}
	writeJSON(w, http.StatusOK, tracks)
}

// Create handles POST /api/v1/tracks -- creates a track owned by the authenticated user.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req createTrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.BPM <= 0 {
		writeError(w, http.StatusBadRequest, "bpm must be positive")
		return
	}

	// Default JSONB fields if not provided.
	if req.ChordSequence == nil {
		req.ChordSequence = json.RawMessage("[]")
	}
	if req.DrumPattern == nil {
		req.DrumPattern = json.RawMessage("{}")
	}
	if req.PlaybackSettings == nil {
		req.PlaybackSettings = json.RawMessage("{}")
	}

	track, err := h.queries.CreateTrack(r.Context(), userID, req.Name, req.ChordSequence, req.DrumPattern, req.BPM, req.PlaybackSettings)
	if err != nil {
		log.Printf("error creating track: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create track")
		return
	}

	writeJSON(w, http.StatusCreated, track)
}

// Get handles GET /api/v1/tracks/:id -- returns the track if owned by authenticated user.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	trackID := chi.URLParam(r, "id")
	if trackID == "" {
		writeError(w, http.StatusBadRequest, "track id is required")
		return
	}

	track, err := h.queries.GetTrackByID(r.Context(), trackID)
	if err != nil {
		log.Printf("error getting track: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get track")
		return
	}
	if track == nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}

	// Ownership check: user can only see their own tracks.
	if track.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	writeJSON(w, http.StatusOK, track)
}

// Update handles PUT /api/v1/tracks/:id -- updates the track if owned by authenticated user.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	trackID := chi.URLParam(r, "id")
	if trackID == "" {
		writeError(w, http.StatusBadRequest, "track id is required")
		return
	}

	// Check ownership first.
	existing, err := h.queries.GetTrackByID(r.Context(), trackID)
	if err != nil {
		log.Printf("error getting track for update: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get track")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if existing.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	var req updateTrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.BPM <= 0 {
		writeError(w, http.StatusBadRequest, "bpm must be positive")
		return
	}

	if req.ChordSequence == nil {
		req.ChordSequence = json.RawMessage("[]")
	}
	if req.DrumPattern == nil {
		req.DrumPattern = json.RawMessage("{}")
	}
	if req.PlaybackSettings == nil {
		req.PlaybackSettings = json.RawMessage("{}")
	}

	track, err := h.queries.UpdateTrack(r.Context(), trackID, req.Name, req.ChordSequence, req.DrumPattern, req.BPM, req.PlaybackSettings)
	if err != nil {
		log.Printf("error updating track: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to update track")
		return
	}

	writeJSON(w, http.StatusOK, track)
}

// Delete handles DELETE /api/v1/tracks/:id -- deletes the track if owned by authenticated user.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	trackID := chi.URLParam(r, "id")
	if trackID == "" {
		writeError(w, http.StatusBadRequest, "track id is required")
		return
	}

	// Check ownership first.
	existing, err := h.queries.GetTrackByID(r.Context(), trackID)
	if err != nil {
		log.Printf("error getting track for delete: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get track")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if existing.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	deleted, err := h.queries.DeleteTrack(r.Context(), trackID)
	if err != nil {
		log.Printf("error deleting track: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to delete track")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// MountRoutes mounts track CRUD routes on the given router.
// All routes require authentication (RequireAuth middleware should be applied by the caller).
func (h *Handler) MountRoutes(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{id}", h.Get)
	r.Put("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
}

// MountAdminRoutes mounts admin-only track routes.
func (h *Handler) MountAdminRoutes(r chi.Router) {
	r.Get("/", h.ListAll)
}
