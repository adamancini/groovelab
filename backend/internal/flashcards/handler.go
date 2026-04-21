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

	// sessions stores in-memory session state keyed by session_id (UUID).
	// Both guest and authenticated sessions are tracked here so we can (a)
	// validate session_id on every POST /flashcards/answer call and (b) emit
	// non-zero session_progress counters. For guests this is also the
	// authoritative mastery store for the session. For authenticated users
	// mastery itself is persisted to the database; this map only tracks
	// progress counters for the lifetime of the session. See GRO-uzk3.
	sessionsMu sync.Mutex
	sessions   map[string]*sessionState
}

// sessionState holds ephemeral progress state for a flashcard session.
// masteryMap is populated only for guest sessions; auth sessions leave it
// empty because mastery is persisted to the database.
type sessionState struct {
	cards      []SessionCard
	masteryMap map[string]*Mastery // card_id -> in-memory mastery (guests only)
	answered   int
	correct    int
	isGuest    bool
}

// NewHandler creates a Handler backed by the given Store and Authboss instance.
func NewHandler(store *Store, ab *authboss.Authboss) *Handler {
	return &Handler{
		store:    store,
		ab:       ab,
		sessions: make(map[string]*sessionState),
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

	// Store session state in memory for BOTH guest and authenticated users.
	// For guests this also carries the mastery map; for auth users only the
	// progress counters are meaningful here (mastery lives in Postgres).
	// See GRO-uzk3: without this, POST /flashcards/answer cannot validate
	// session_id for auth users and session_progress silently returns zeros.
	ss := &sessionState{
		cards:      session,
		masteryMap: make(map[string]*Mastery),
		isGuest:    userID == "",
	}
	h.sessionsMu.Lock()
	h.sessions[sessionID] = ss
	h.sessionsMu.Unlock()

	resp := SessionResponse{
		SessionID: sessionID,
		Topic:     topic,
		Cards:     session,
		Total:     len(session),
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleAnswer processes an answer submission.
// POST /api/v1/flashcards/answer?session_id=<uuid>
//
// session_id is REQUIRED. A missing or unknown session_id returns 404.
// This prevents the silent-zero-progress bug (GRO-uzk3) where a frontend
// that forgot to thread the session_id would see 200 OK with all counters
// reading zero.
func (h *Handler) handleAnswer(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown session"})
		return
	}

	// Validate the session exists in our in-memory map. Lookup under the
	// mutex to stay consistent with the rest of the session-state API.
	h.sessionsMu.Lock()
	_, sessionExists := h.sessions[sessionID]
	h.sessionsMu.Unlock()
	if !sessionExists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown session"})
		return
	}

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

	// Update session progress counters for both guest and auth sessions.
	// Unlike mastery (persistent for auth, in-memory for guest), these are
	// session-scoped — they live only as long as the in-memory sessionState.
	h.updateSessionProgress(sessionID, correct)

	// Build explanation.
	explanation := "Incorrect."
	if correct {
		explanation = "Correct!"
	}

	// Build session progress.
	progress := h.getSessionProgress(sessionID)

	// Populate the next card in the session (if any remain). Both guest and
	// auth sessions carry a card list, so next_card is available for both.
	nextCard := h.getSessionNextCard(sessionID)

	resp := AnswerResponse{
		Correct:         correct,
		CorrectAnswer:   card.CorrectAnswer,
		Explanation:     explanation,
		NextCard:        nextCard,
		SessionProgress: progress,
	}

	writeJSON(w, http.StatusOK, resp)
}

// getGuestMastery retrieves in-memory mastery for a guest session.
func (h *Handler) getGuestMastery(sessionID, cardID string) *Mastery {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	ss, ok := h.sessions[sessionID]
	if !ok {
		return nil
	}
	return ss.masteryMap[cardID]
}

// setGuestMastery stores in-memory mastery for a guest session.
func (h *Handler) setGuestMastery(sessionID, cardID string, m *Mastery) {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	ss, ok := h.sessions[sessionID]
	if !ok {
		return
	}
	ss.masteryMap[cardID] = m
}

// updateSessionProgress increments the answered/correct counters for the
// session. Applies to both guest and auth sessions. Callers have already
// validated that the session exists (handleAnswer returns 404 otherwise),
// but we still no-op on a missing key to stay defensive.
func (h *Handler) updateSessionProgress(sessionID string, correct bool) {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	ss, ok := h.sessions[sessionID]
	if !ok {
		return
	}
	ss.answered++
	if correct {
		ss.correct++
	}
}

// getSessionNextCard returns the next unanswered card in a session,
// or nil if all cards have been answered. Must be called after
// updateSessionProgress has incremented the answered counter.
func (h *Handler) getSessionNextCard(sessionID string) *SessionCard {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	ss, ok := h.sessions[sessionID]
	if !ok {
		return nil
	}
	if ss.answered >= len(ss.cards) {
		return nil
	}
	next := ss.cards[ss.answered]
	return &next
}

// getSessionProgress returns progress counters for the session. Applies to
// both guest and auth sessions: the in-memory sessionState is the source of
// truth for counters regardless of authentication. Callers have already
// validated that the session exists; we still return a zero struct for a
// missing session to stay defensive.
func (h *Handler) getSessionProgress(sessionID string) SessionProgress {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	ss, ok := h.sessions[sessionID]
	if !ok {
		return SessionProgress{}
	}
	return SessionProgress{
		Answered:  ss.answered,
		Total:     len(ss.cards),
		Correct:   ss.correct,
		Incorrect: ss.answered - ss.correct,
	}
}

// writeJSON is a helper that encodes v as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("error encoding JSON response: %v", err)
	}
}
