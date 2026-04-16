// Package progress provides HTTP handlers for practice progress and streak tracking.
package progress

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	grooveauth "github.com/adamancini/groovelab/internal/auth"
	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/aarondl/authboss/v3"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds dependencies for progress handlers.
type Handler struct {
	queries *queries.Querier
	ab      *authboss.Authboss
}

// NewHandler creates a new progress handler.
func NewHandler(pool *pgxpool.Pool, ab *authboss.Authboss) *Handler {
	return &Handler{
		queries: queries.New(pool),
		ab:      ab,
	}
}

// StreaksResponse is the JSON response for GET /api/v1/progress/streaks.
type StreaksResponse struct {
	CurrentDailyStreak int `json:"current_daily_streak"`
	BestDailyStreak    int `json:"best_daily_streak"`
	TodaySessionBest   int `json:"today_session_best"`
}

// DashboardResponse is the JSON response for GET /api/v1/progress/dashboard.
type DashboardResponse struct {
	OverallAccuracy  float64            `json:"overall_accuracy"`
	TopicAccuracy    map[string]float64 `json:"topic_accuracy"`
	WeakAreas        []string           `json:"weak_areas"`
	CardsMastered    int                `json:"cards_mastered"`
	TotalCards       int                `json:"total_cards"`
	CurrentStreak    int                `json:"current_streak"`
	BestStreak       int                `json:"best_streak"`
	TodaySessionBest int                `json:"today_session_best"`
}

// UpsertStreakRequest is the JSON body for POST /api/v1/progress/streaks.
type UpsertStreakRequest struct {
	PracticeDate         string `json:"practice_date"`
	SessionCorrectStreak int    `json:"session_correct_streak"`
	SessionBestStreak    int    `json:"session_best_streak"`
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

// GetStreaks handles GET /api/v1/progress/streaks.
// Returns current daily streak, best daily streak, and today's session best.
func (h *Handler) GetStreaks(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	ctx := r.Context()

	currentStreak, err := h.queries.GetDailyStreakCount(ctx, userID)
	if err != nil {
		log.Printf("error getting daily streak count: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get streak data")
		return
	}

	bestStreak, err := h.queries.GetBestDailyStreak(ctx, userID)
	if err != nil {
		log.Printf("error getting best daily streak: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get streak data")
		return
	}

	// Get today's session best streak.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	todaySessionBest := 0
	todayStreak, err := h.queries.GetStreakByDate(ctx, userID, today)
	if err != nil {
		log.Printf("error getting today's streak: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get streak data")
		return
	}
	if todayStreak != nil {
		todaySessionBest = todayStreak.SessionBestStreak
	}

	writeJSON(w, http.StatusOK, StreaksResponse{
		CurrentDailyStreak: currentStreak,
		BestDailyStreak:    bestStreak,
		TodaySessionBest:   todaySessionBest,
	})
}

// RecordStreak handles POST /api/v1/progress/streaks.
// Upserts a streak record for the given date.
func (h *Handler) RecordStreak(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req UpsertStreakRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var practiceDate time.Time
	if req.PracticeDate == "" {
		practiceDate = time.Now().UTC().Truncate(24 * time.Hour)
	} else {
		practiceDate, err = time.Parse("2006-01-02", req.PracticeDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid practice_date format, expected YYYY-MM-DD")
			return
		}
	}

	streak, err := h.queries.UpsertStreak(r.Context(), userID, practiceDate, req.SessionCorrectStreak, req.SessionBestStreak)
	if err != nil {
		log.Printf("error upserting streak: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to record streak")
		return
	}

	writeJSON(w, http.StatusOK, streak)
}

// GetDashboard handles GET /api/v1/progress/dashboard.
// Returns practice statistics: per-topic accuracy, weak areas, mastered cards,
// and streak info. Currently returns streak data and placeholder values for
// accuracy stats until flashcard tracking is implemented.
func (h *Handler) GetDashboard(w http.ResponseWriter, r *http.Request) {
	userID, err := h.currentUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	ctx := r.Context()

	currentStreak, err := h.queries.GetDailyStreakCount(ctx, userID)
	if err != nil {
		log.Printf("error getting daily streak count for dashboard: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get dashboard data")
		return
	}

	bestStreak, err := h.queries.GetBestDailyStreak(ctx, userID)
	if err != nil {
		log.Printf("error getting best daily streak for dashboard: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get dashboard data")
		return
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	todaySessionBest := 0
	todayStreak, err := h.queries.GetStreakByDate(ctx, userID, today)
	if err != nil {
		log.Printf("error getting today's streak for dashboard: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get dashboard data")
		return
	}
	if todayStreak != nil {
		todaySessionBest = todayStreak.SessionBestStreak
	}

	// Accuracy and mastery data will be populated once flashcard tracking is
	// implemented. For now, return zero values and empty collections.
	dashboard := DashboardResponse{
		OverallAccuracy:  0.0,
		TopicAccuracy:    map[string]float64{},
		WeakAreas:        []string{},
		CardsMastered:    0,
		TotalCards:       0,
		CurrentStreak:    currentStreak,
		BestStreak:       bestStreak,
		TodaySessionBest: todaySessionBest,
	}

	writeJSON(w, http.StatusOK, dashboard)
}

// MountRoutes mounts progress routes on the given router.
// All routes require authentication (RequireAuth middleware should be applied by the caller).
func (h *Handler) MountRoutes(r chi.Router) {
	r.Get("/streaks", h.GetStreaks)
	r.Post("/streaks", h.RecordStreak)
	r.Get("/dashboard", h.GetDashboard)
}
