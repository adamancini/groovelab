// Package admin provides HTTP handlers for administrative endpoints.
// All handlers assume RequireAuth + RequireAdmin middleware is applied.
package admin

import (
	"encoding/json"
	"log"
	"net/http"

	grooveauth "github.com/adamancini/groovelab/internal/auth"
	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/aarondl/authboss/v3"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds dependencies for admin API handlers.
type Handler struct {
	queries *queries.Querier
	ab      *authboss.Authboss
}

// NewHandler creates a new admin handler.
func NewHandler(pool *pgxpool.Pool, ab *authboss.Authboss) *Handler {
	return &Handler{
		queries: queries.New(pool),
		ab:      ab,
	}
}

// updateUserRequest is the JSON body for PUT /api/v1/admin/users/:id.
type updateUserRequest struct {
	Role    *string `json:"role"`
	Enabled *bool   `json:"enabled"`
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

// ListUsers handles GET /api/v1/admin/users -- returns all users.
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.queries.ListAllUsers(r.Context())
	if err != nil {
		log.Printf("error listing users: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	if users == nil {
		users = []*queries.User{}
	}

	// Build response with only admin-relevant fields.
	type userResponse struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Role      string `json:"role"`
		Enabled   bool   `json:"enabled"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}

	resp := make([]userResponse, len(users))
	for i, u := range users {
		resp[i] = userResponse{
			ID:        u.ID,
			Email:     u.Email,
			Role:      u.Role,
			Enabled:   u.Enabled,
			CreatedAt: u.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt: u.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// UpdateUser handles PUT /api/v1/admin/users/:id -- updates role and/or enabled.
func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "user id is required")
		return
	}

	var req updateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Look up the target user.
	existing, err := h.queries.GetUserByID(r.Context(), targetID)
	if err != nil {
		log.Printf("error getting user for admin update: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	// Determine new values (keep existing if not provided).
	newRole := existing.Role
	if req.Role != nil {
		if *req.Role != "user" && *req.Role != "admin" {
			writeError(w, http.StatusBadRequest, "role must be 'user' or 'admin'")
			return
		}
		newRole = *req.Role
	}

	newEnabled := existing.Enabled
	if req.Enabled != nil {
		newEnabled = *req.Enabled
	}

	// Prevent admins from disabling themselves.
	currentUserID, err := h.currentUserID(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to identify current user")
		return
	}
	if targetID == currentUserID && !newEnabled {
		writeError(w, http.StatusBadRequest, "cannot disable your own account")
		return
	}

	updated, err := h.queries.UpdateUserAdmin(r.Context(), targetID, newRole, newEnabled)
	if err != nil {
		log.Printf("error updating user: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	type userResponse struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Role      string `json:"role"`
		Enabled   bool   `json:"enabled"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	}

	writeJSON(w, http.StatusOK, userResponse{
		ID:        updated.ID,
		Email:     updated.Email,
		Role:      updated.Role,
		Enabled:   updated.Enabled,
		CreatedAt: updated.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: updated.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	})
}

// ListTracks handles GET /api/v1/admin/tracks -- returns all tracks with user email.
func (h *Handler) ListTracks(w http.ResponseWriter, r *http.Request) {
	tracks, err := h.queries.ListAllTracksWithEmail(r.Context())
	if err != nil {
		log.Printf("error listing admin tracks: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to list tracks")
		return
	}

	if tracks == nil {
		tracks = []*queries.AdminTrack{}
	}

	// Build response with chord count.
	type trackResponse struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		UserID     string `json:"user_id"`
		UserEmail  string `json:"user_email"`
		ChordCount int    `json:"chord_count"`
		CreatedAt  string `json:"created_at"`
		UpdatedAt  string `json:"updated_at"`
	}

	resp := make([]trackResponse, len(tracks))
	for i, t := range tracks {
		// Count chords by unmarshalling the JSON array.
		var chords []json.RawMessage
		chordCount := 0
		if err := json.Unmarshal(t.ChordSequence, &chords); err == nil {
			chordCount = len(chords)
		}

		resp[i] = trackResponse{
			ID:         t.ID,
			Name:       t.Name,
			UserID:     t.UserID,
			UserEmail:  t.UserEmail,
			ChordCount: chordCount,
			CreatedAt:  t.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:  t.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// DeleteTrack handles DELETE /api/v1/admin/tracks/:id -- deletes any track.
func (h *Handler) DeleteTrack(w http.ResponseWriter, r *http.Request) {
	trackID := chi.URLParam(r, "id")
	if trackID == "" {
		writeError(w, http.StatusBadRequest, "track id is required")
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

// MountRoutes mounts admin API routes on the given router.
// The caller is expected to apply RequireAuth + RequireAdmin middleware.
func (h *Handler) MountRoutes(r chi.Router) {
	r.Get("/users", h.ListUsers)
	r.Put("/users/{id}", h.UpdateUser)
	r.Get("/tracks", h.ListTracks)
	r.Delete("/tracks/{id}", h.DeleteTrack)
}
