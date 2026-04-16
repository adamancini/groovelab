package flashcards

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/aarondl/authboss/v3"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Handler provides HTTP endpoints for the flashcard engine.
type Handler struct {
	store *Store
	ab    *authboss.Authboss

	// guestSessions stores in-memory session state for unauthenticated users.
	// Key: session_id (UUID), Value: *guestSession.
	guestMu       sync.Mutex
	guestSessions map[string]*guestSession
}

// guestSession holds ephemeral state for a guest user's flashcard session.
type guestSession struct {
	cards      []SessionCard
	masteryMap map[string]*Mastery // card_id -> in-memory mastery
	answered   int
	correct    int
}

// NewHandler creates a Handler backed by the given Store and Authboss instance.
func NewHandler(store *Store, ab *authboss.Authboss) *Handler {
	return &Handler{
		store:         store,
		ab:            ab,
		guestSessions: make(map[string]*guestSession),
	}
}

// MountRoutes registers flashcard endpoints on the given Chi router.
// Routes are mounted under the provided prefix (e.g., "/api/v1/flashcards").
func (h *Handler) MountRoutes(r chi.Router, prefix string) {
	r.Route(prefix, func(r chi.Router) {
		r.Get("/topics", h.handleTopics)
		r.Get("/session", h.handleSession)
		r.Post("/answer", h.handleAnswer)
	})
}

// currentUserID attempts to load the current user from the Authboss context.
// Returns the user's UUID string, or an empty string when the request is
// unauthenticated (guest access). The empty-string return is intentional --
// guest users interact with flashcards via ephemeral in-memory sessions.
func (h *Handler) currentUserID(r *http.Request) string {
	const guestID = "" // guests have no persisted identity

	user, err := h.ab.LoadCurrentUser(&r)
	if err != nil || user == nil {
		return guestID
	}

	// ABUser implements authboss.User with GetPID() returning the user's email.
	// We resolve the email to a UUID via a database lookup.
	type idGetter interface {
		GetPID() string
	}
	ig, ok := user.(idGetter)
	if !ok {
		return guestID
	}

	pid := ig.GetPID()
	var userID string
	err = h.store.pool.QueryRow(r.Context(),
		`SELECT id FROM users WHERE email = $1`, pid,
	).Scan(&userID)
	if err != nil {
		return guestID
	}
	return userID
}

// handleTopics returns all topics with optional mastery information.
// GET /api/v1/flashcards/topics
func (h *Handler) handleTopics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := h.currentUserID(r)

	var summaries []TopicSummary
	var err error

	if userID != "" {
		summaries, err = h.store.GetTopicMasteryForUser(ctx, userID)
	} else {
		summaries, err = h.store.GetTopicSummaries(ctx)
	}
	if err != nil {
		log.Printf("error fetching topics: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, summaries)
}

// handleSession starts a new adaptive practice session.
// GET /api/v1/flashcards/session?topic=TOPIC
func (h *Handler) handleSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	topic := r.URL.Query().Get("topic")
	if topic == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "topic query parameter required"})
		return
	}

	// Fetch all cards for the topic.
	cards, err := h.store.ListCardsByTopic(ctx, topic)
	if err != nil {
		log.Printf("error listing cards: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if len(cards) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no cards found for topic"})
		return
	}

	userID := h.currentUserID(r)

	// Build mastery map.
	masteryMap := make(map[string]*Mastery)
	if userID != "" {
		records, err := h.store.GetMasteryForUser(ctx, userID, topic)
		if err != nil {
			log.Printf("error fetching mastery: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		for i := range records {
			masteryMap[records[i].CardID] = &records[i]
		}
	}
	// For guests, masteryMap is empty (all cards are "new").

	session := BuildSession(cards, masteryMap)
	sessionID := uuid.New().String()

	// For guest users, store the session in memory.
	if userID == "" {
		gs := &guestSession{
			cards:      session,
			masteryMap: make(map[string]*Mastery),
		}
		h.guestMu.Lock()
		h.guestSessions[sessionID] = gs
		h.guestMu.Unlock()
	}

	resp := SessionResponse{
		SessionID: sessionID,
		Topic:     topic,
		Cards:     session,
		Total:     len(session),
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleAnswer processes an answer submission.
// POST /api/v1/flashcards/answer
func (h *Handler) handleAnswer(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req AnswerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.CardID == "" || req.InputMethod == "" || len(req.Answer) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "card_id, answer, and input_method are required"})
		return
	}

	// Look up the card.
	card, err := h.store.GetCardByID(ctx, req.CardID)
	if err != nil {
		log.Printf("error fetching card: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if card == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "card not found"})
		return
	}

	userID := h.currentUserID(r)
	sessionID := r.URL.Query().Get("session_id")

	var mastery *Mastery
	isGuest := userID == ""

	if isGuest {
		// Guest: use in-memory mastery from the session.
		mastery = h.getGuestMastery(sessionID, req.CardID)
		if mastery == nil {
			mastery = &Mastery{
				UserID: "guest",
				CardID: req.CardID,
			}
		}
	} else {
		// Authenticated: load from database.
		mastery, err = h.store.GetMasteryByUserAndCard(ctx, userID, req.CardID)
		if err != nil {
			log.Printf("error fetching mastery: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		if mastery == nil {
			mastery = &Mastery{
				UserID: userID,
				CardID: req.CardID,
			}
		}
	}

	correct := ProcessAnswer(mastery, card, req.Answer)

	if isGuest {
		// Update in-memory session mastery.
		h.setGuestMastery(sessionID, req.CardID, mastery)
		h.updateGuestProgress(sessionID, correct)
	} else {
		// Persist attempt and mastery to the database.
		attempt := &Attempt{
			UserID:         userID,
			CardID:         req.CardID,
			Correct:        correct,
			InputMethod:    req.InputMethod,
			ResponseTimeMs: req.ResponseTimeMs,
		}
		if err := h.store.RecordAttempt(ctx, attempt); err != nil {
			log.Printf("error recording attempt: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		mastery.UserID = userID
		if err := h.store.UpsertMastery(ctx, mastery); err != nil {
			log.Printf("error upserting mastery: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
	}

	// Build explanation.
	explanation := "Incorrect."
	if correct {
		explanation = "Correct!"
	}

	// Build session progress.
	progress := h.getSessionProgress(sessionID, isGuest)

	resp := AnswerResponse{
		Correct:         correct,
		CorrectAnswer:   card.CorrectAnswer,
		Explanation:     explanation,
		SessionProgress: progress,
	}

	writeJSON(w, http.StatusOK, resp)
}

// getGuestMastery retrieves in-memory mastery for a guest session.
func (h *Handler) getGuestMastery(sessionID, cardID string) *Mastery {
	h.guestMu.Lock()
	defer h.guestMu.Unlock()
	gs, ok := h.guestSessions[sessionID]
	if !ok {
		return nil
	}
	return gs.masteryMap[cardID]
}

// setGuestMastery stores in-memory mastery for a guest session.
func (h *Handler) setGuestMastery(sessionID, cardID string, m *Mastery) {
	h.guestMu.Lock()
	defer h.guestMu.Unlock()
	gs, ok := h.guestSessions[sessionID]
	if !ok {
		return
	}
	gs.masteryMap[cardID] = m
}

// updateGuestProgress increments the answered/correct counters for a guest session.
func (h *Handler) updateGuestProgress(sessionID string, correct bool) {
	h.guestMu.Lock()
	defer h.guestMu.Unlock()
	gs, ok := h.guestSessions[sessionID]
	if !ok {
		return
	}
	gs.answered++
	if correct {
		gs.correct++
	}
}

// getSessionProgress returns progress counters for the session.
func (h *Handler) getSessionProgress(sessionID string, isGuest bool) SessionProgress {
	if isGuest && sessionID != "" {
		h.guestMu.Lock()
		defer h.guestMu.Unlock()
		gs, ok := h.guestSessions[sessionID]
		if ok {
			return SessionProgress{
				Answered:  gs.answered,
				Total:     len(gs.cards),
				Correct:   gs.correct,
				Incorrect: gs.answered - gs.correct,
			}
		}
	}
	// For authenticated users or missing sessions, return empty progress.
	// Session progress tracking for auth users would require session storage.
	return SessionProgress{}
}

// writeJSON is a helper that encodes v as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("error encoding JSON response: %v", err)
	}
}
