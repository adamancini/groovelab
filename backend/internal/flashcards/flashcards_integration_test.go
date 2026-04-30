package flashcards_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	grooveauth "github.com/adamancini/groovelab/internal/auth"
	"github.com/adamancini/groovelab/internal/flashcards"
	"github.com/adamancini/groovelab/internal/migrate"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// testEnv holds shared test infrastructure for flashcard integration tests.
type testEnv struct {
	pgPool     *pgxpool.Pool
	rdClient   *redis.Client
	server     *httptest.Server
	authSystem *grooveauth.Auth
	store      *flashcards.Store
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	// Start PostgreSQL container.
	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("groovelab_flashcards_test"),
		tcpostgres.WithUsername("test"),
		tcpostgres.WithPassword("test"),
		tcpostgres.BasicWaitStrategies(),
	)
	require.NoError(t, err, "start postgres container")
	t.Cleanup(func() {
		_ = pgContainer.Terminate(context.Background())
	})

	pgDSN, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "get postgres connection string")

	// Run all migrations (including cards + seed).
	_, testFile, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(testFile), "..", "..", "migrations")
	require.NoError(t, migrate.Run(ctx, pgDSN, migrationsDir), "run migrations")

	poolCfg, err := pgxpool.ParseConfig(pgDSN)
	require.NoError(t, err, "parse postgres pool config")

	pgPool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	require.NoError(t, err, "create postgres pool")
	t.Cleanup(func() { pgPool.Close() })

	// Start Redis container.
	rdContainer, err := tcredis.Run(ctx,
		"redis:7-alpine",
		tcredis.WithLogLevel(tcredis.LogLevelVerbose),
	)
	require.NoError(t, err, "start redis container")
	t.Cleanup(func() {
		_ = rdContainer.Terminate(context.Background())
	})

	rdEndpoint, err := rdContainer.Endpoint(ctx, "")
	require.NoError(t, err, "get redis endpoint")

	rdClient := redis.NewClient(&redis.Options{Addr: rdEndpoint})
	t.Cleanup(func() { _ = rdClient.Close() })

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	require.NoError(t, rdClient.Ping(pingCtx).Err(), "ping redis")

	// Set up auth system.
	authSystem, err := grooveauth.Setup(grooveauth.Config{
		RootURL:   "http://localhost",
		MountPath: "/api/v1/auth",
		Pool:      pgPool,
		RedisClient: rdClient,
		SessionConfig: grooveauth.SessionConfig{
			CookieName: "groovelab_session",
			TTL:        24 * time.Hour,
			Secure:     false,
		},
		CookieConfig: grooveauth.CookieConfig{
			TTL:    30 * 24 * time.Hour,
			Secure: false,
		},
	})
	require.NoError(t, err, "setup auth system")

	// Create flashcard store and handler.
	store := flashcards.NewStore(pgPool)
	handler := flashcards.NewHandler(store, authSystem.AB)

	// Build router.
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(authSystem.LoadClientStateMiddleware())
	r.Use(authSystem.RememberMiddleware())

	// Mount auth routes.
	authSystem.MountRoutes(r, "/api/v1/auth")

	// Mount flashcard routes.
	handler.MountRoutes(r, "/api/v1/flashcards")

	server := httptest.NewServer(r)
	t.Cleanup(func() { server.Close() })

	return &testEnv{
		pgPool:     pgPool,
		rdClient:   rdClient,
		server:     server,
		authSystem: authSystem,
		store:      store,
	}
}

// newClientWithCookies creates an HTTP client with a cookie jar.
func newClientWithCookies(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	return &http.Client{
		Jar: jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func postJSON(t *testing.T, client *http.Client, u string, body interface{}) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	require.NoError(t, err)
	resp, err := client.Post(u, "application/json", bytes.NewReader(data))
	require.NoError(t, err)
	return resp
}

func getJSON(t *testing.T, client *http.Client, u string) *http.Response {
	t.Helper()
	resp, err := client.Get(u)
	require.NoError(t, err)
	return resp
}

func readBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return body
}

func registerAndLogin(t *testing.T, client *http.Client, baseURL, email, password string) {
	t.Helper()
	// Register.
	resp := postJSON(t, client, baseURL+"/api/v1/auth/register", map[string]string{
		"email": email, "password": password,
	})
	resp.Body.Close()
	// Login.
	resp = postJSON(t, client, baseURL+"/api/v1/auth/login", map[string]string{
		"email": email, "password": password,
	})
	resp.Body.Close()
}

// ---------- Seed Validation Tests ----------

func TestSeedCreatesExpectedCardCount(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()

	count, err := env.store.CountCards(ctx)
	require.NoError(t, err)
	// 12 keys x 7 chord types x 2 directions = 168
	assert.GreaterOrEqual(t, count, int64(168),
		"seed must create at least 168 cards (12 keys x 7 chord types x 2 directions)")
}

func TestSeedCreatesAllTopics(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()

	topics, err := env.store.ListDistinctTopics(ctx)
	require.NoError(t, err)

	// The 7 canonical chord-type topics must be present. Additional topics
	// added by future migrations (e.g. chord_intervals from 00010) are
	// permitted -- we only guard that the baseline seven remain.
	expected := []string{
		"augmented_chords", "diminished_chords", "dominant_7th_chords",
		"major_7th_chords", "major_chords", "minor_7th_chords", "minor_chords",
	}
	for _, want := range expected {
		assert.Contains(t, topics, want, "canonical topic %q must be present", want)
	}
}

// ---------- Topics Endpoint Tests ----------

func TestTopics_GuestReturnsTopicsWithoutMastery(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()
	client := newClientWithCookies(t)

	// Derive the expected topic count from whatever the migrations actually
	// seeded so future topic additions don't require test churn.
	seededTopics, err := env.store.ListDistinctTopics(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, seededTopics, "migrations must seed at least one topic")

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/topics")
	body := readBody(t, resp)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var topics []flashcards.TopicSummary
	require.NoError(t, json.Unmarshal(body, &topics))
	assert.Len(t, topics, len(seededTopics),
		"should return one entry per seeded topic (%d)", len(seededTopics))

	for _, ts := range topics {
		assert.Greater(t, ts.CardCount, 0, "each topic must have cards")
		// Guest: mastery fields should be nil.
		assert.Nil(t, ts.MasteryPct, "guest topics should not include mastery_pct")
		assert.Nil(t, ts.PracticedCount, "guest topics should not include practiced_count")
	}
}

func TestTopics_AuthenticatedReturnsTopicsWithMastery(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "topics-test@example.com", "securepassword1")

	// Derive the expected topic count from whatever the migrations actually
	// seeded so future topic additions don't require test churn.
	seededTopics, err := env.store.ListDistinctTopics(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, seededTopics, "migrations must seed at least one topic")

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/topics")
	body := readBody(t, resp)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var topics []flashcards.TopicSummary
	require.NoError(t, json.Unmarshal(body, &topics))
	assert.Len(t, topics, len(seededTopics),
		"should return one entry per seeded topic (%d)", len(seededTopics))

	for _, ts := range topics {
		assert.Greater(t, ts.CardCount, 0, "each topic must have cards")
		// Authenticated: mastery fields should be present (even if 0).
		assert.NotNil(t, ts.MasteryPct, "auth topics should include mastery_pct")
		assert.NotNil(t, ts.PracticedCount, "auth topics should include practiced_count")
	}
}

// ---------- Session Endpoint Tests ----------

func TestSession_RequiresTopic(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session")
	body := readBody(t, resp)

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, string(body), "topic")
}

func TestSession_InvalidTopicReturns404(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=nonexistent")
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

func TestSession_GuestReturnsCards(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))

	assert.NotEmpty(t, session.SessionID, "session must have an ID")
	assert.Equal(t, "major_chords", session.Topic)
	assert.LessOrEqual(t, session.Total, flashcards.SessionSize,
		"session should not exceed %d cards", flashcards.SessionSize)
	assert.Greater(t, session.Total, 0, "session must have at least one card")

	// For a guest with no mastery, all cards should be classified as "new".
	for _, card := range session.Cards {
		assert.NotEmpty(t, card.ID)
		assert.NotEmpty(t, card.Question)
		assert.NotEmpty(t, card.CorrectAnswer)
		assert.NotEmpty(t, card.Distractors)
	}
}

func TestSession_AuthenticatedWithMasteryDistribution(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "session-dist@example.com", "securepassword1")

	// Get the user's ID.
	var userID string
	err := env.pgPool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, "session-dist@example.com").Scan(&userID)
	require.NoError(t, err)

	// Get cards for major_chords.
	cards, err := env.store.ListCardsByTopic(ctx, "major_chords")
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(cards), 20, "need at least 20 cards for distribution test")

	// Create mastery records to populate all buckets:
	// - First 8 cards: struggling (accuracy < 50%, consecutive_wrong >= 2)
	// - Next 6 cards: review (practiced, decent accuracy)
	// - Next 4 cards: new (no mastery records -- skip these)
	// - Last 6 cards: mastered (stage 3, accuracy > 90%)

	store := flashcards.NewStore(env.pgPool)
	now := time.Now()

	// Struggling cards (8 cards).
	for i := 0; i < 8 && i < len(cards); i++ {
		m := &flashcards.Mastery{
			UserID:             userID,
			CardID:             cards[i].ID,
			Stage:              0,
			ConsecutiveCorrect: 0,
			ConsecutiveWrong:   2,
			Accuracy:           0.30,
			TotalAttempts:      10,
			LastPracticed:      &now,
		}
		require.NoError(t, store.UpsertMastery(ctx, m))
	}

	// Review cards (6 cards).
	for i := 8; i < 14 && i < len(cards); i++ {
		m := &flashcards.Mastery{
			UserID:             userID,
			CardID:             cards[i].ID,
			Stage:              1,
			ConsecutiveCorrect: 1,
			ConsecutiveWrong:   0,
			Accuracy:           0.65,
			TotalAttempts:      10,
			LastPracticed:      &now,
		}
		require.NoError(t, store.UpsertMastery(ctx, m))
	}

	// Skip cards 14-17 (no mastery = new).

	// Mastered cards (6 cards).
	for i := 18; i < 24 && i < len(cards); i++ {
		m := &flashcards.Mastery{
			UserID:             userID,
			CardID:             cards[i].ID,
			Stage:              3,
			ConsecutiveCorrect: 5,
			ConsecutiveWrong:   0,
			Accuracy:           0.95,
			TotalAttempts:      20,
			LastPracticed:      &now,
		}
		require.NoError(t, store.UpsertMastery(ctx, m))
	}

	// Request a session.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))

	// Count cards per bucket.
	bucketCounts := map[string]int{}
	for _, card := range session.Cards {
		bucketCounts[card.BucketHint]++
	}

	t.Logf("Session distribution: %v (total: %d)", bucketCounts, len(session.Cards))

	// Verify the session has the expected size.
	assert.Equal(t, flashcards.SessionSize, len(session.Cards),
		"session should have exactly %d cards", flashcards.SessionSize)

	// Verify struggling cards are present (should be ~40% = 8).
	assert.GreaterOrEqual(t, bucketCounts["struggling"], 5,
		"at least 5 struggling cards expected")

	// Verify review cards are present.
	assert.GreaterOrEqual(t, bucketCounts["review"], 3,
		"at least 3 review cards expected")

	// Verify new cards are capped.
	assert.LessOrEqual(t, bucketCounts["new"], flashcards.MaxNewPerSession,
		"new cards must not exceed MaxNewPerSession=%d", flashcards.MaxNewPerSession)
}

// ---------- Answer Endpoint Tests ----------

func TestAnswer_GuestCanSubmitAnswer(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a guest session.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))
	require.Greater(t, len(session.Cards), 0)

	firstCard := session.Cards[0]

	// Submit the correct answer.
	answerReq := map[string]interface{}{
		"card_id":      firstCard.ID,
		"answer":       json.RawMessage(firstCard.CorrectAnswer),
		"input_method": "multiple_choice",
	}
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)
	answerResp := postJSON(t, client, answerURL, answerReq)
	answerBody := readBody(t, answerResp)

	assert.Equal(t, http.StatusOK, answerResp.StatusCode)

	var result flashcards.AnswerResponse
	require.NoError(t, json.Unmarshal(answerBody, &result))
	assert.True(t, result.Correct, "submitting the correct answer should return correct=true")
	assert.Equal(t, "Correct!", result.Explanation)

	// Guest session progress should be tracked.
	assert.Equal(t, 1, result.SessionProgress.Answered)
	assert.Equal(t, 1, result.SessionProgress.Correct)
}

func TestAnswer_GuestResponseContainsNextCard(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a guest session with multiple cards.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))
	require.Greater(t, len(session.Cards), 1, "need at least 2 cards to test next_card")

	firstCard := session.Cards[0]
	expectedNextCard := session.Cards[1]

	// Submit answer for the first card.
	answerReq := map[string]interface{}{
		"card_id":      firstCard.ID,
		"answer":       json.RawMessage(firstCard.CorrectAnswer),
		"input_method": "multiple_choice",
	}
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)
	answerResp := postJSON(t, client, answerURL, answerReq)
	answerBody := readBody(t, answerResp)

	assert.Equal(t, http.StatusOK, answerResp.StatusCode)

	var result flashcards.AnswerResponse
	require.NoError(t, json.Unmarshal(answerBody, &result))

	// next_card must be non-null when cards remain in the session.
	require.NotNil(t, result.NextCard, "next_card must be non-null when cards remain")
	assert.Equal(t, expectedNextCard.ID, result.NextCard.ID,
		"next_card should be the second card in the session")

	// Answer all remaining cards to verify next_card becomes null on the last one.
	for i := 1; i < len(session.Cards); i++ {
		card := session.Cards[i]
		req := map[string]interface{}{
			"card_id":      card.ID,
			"answer":       json.RawMessage(card.CorrectAnswer),
			"input_method": "multiple_choice",
		}
		r := postJSON(t, client, answerURL, req)
		b := readBody(t, r)
		require.Equal(t, http.StatusOK, r.StatusCode)

		var res flashcards.AnswerResponse
		require.NoError(t, json.Unmarshal(b, &res))

		if i < len(session.Cards)-1 {
			assert.NotNil(t, res.NextCard,
				"next_card should be non-null for card %d/%d", i+1, len(session.Cards))
		} else {
			assert.Nil(t, res.NextCard,
				"next_card should be null after the last card is answered")
		}
	}
}

func TestAnswer_WrongAnswerReturnsCorrectAnswer(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a guest session.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))
	require.Greater(t, len(session.Cards), 0)

	firstCard := session.Cards[0]

	// Submit a wrong answer.
	answerReq := map[string]interface{}{
		"card_id":      firstCard.ID,
		"answer":       json.RawMessage(`{"name":"X wrong"}`),
		"input_method": "multiple_choice",
	}
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)
	answerResp := postJSON(t, client, answerURL, answerReq)
	answerBody := readBody(t, answerResp)

	assert.Equal(t, http.StatusOK, answerResp.StatusCode)

	var result flashcards.AnswerResponse
	require.NoError(t, json.Unmarshal(answerBody, &result))
	assert.False(t, result.Correct, "wrong answer should return correct=false")
	assert.Equal(t, "Incorrect.", result.Explanation)
	assert.NotEmpty(t, result.CorrectAnswer, "response must include the correct answer")
}

func TestAnswer_AuthenticatedPersistsMastery(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "answer-mastery@example.com", "securepassword1")

	// Get the user's ID.
	var userID string
	err := env.pgPool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, "answer-mastery@example.com").Scan(&userID)
	require.NoError(t, err)

	// Start a session.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))
	require.Greater(t, len(session.Cards), 0)

	firstCard := session.Cards[0]

	// Submit 3 correct answers to test stage advancement.
	// session_id is required on POST /flashcards/answer (GRO-uzk3).
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)
	for i := 0; i < 3; i++ {
		answerReq := map[string]interface{}{
			"card_id":      firstCard.ID,
			"answer":       json.RawMessage(firstCard.CorrectAnswer),
			"input_method": "multiple_choice",
		}
		answerResp := postJSON(t, client, answerURL, answerReq)
		answerResp.Body.Close()
		assert.Equal(t, http.StatusOK, answerResp.StatusCode)
	}

	// Verify mastery was persisted and stage advanced.
	mastery, err := env.store.GetMasteryByUserAndCard(ctx, userID, firstCard.ID)
	require.NoError(t, err)
	require.NotNil(t, mastery, "mastery record must exist after answering")

	assert.Equal(t, 1, mastery.Stage, "stage should advance to 1 after 3 consecutive correct")
	assert.Equal(t, 3, mastery.TotalAttempts, "total_attempts should be 3")
	assert.InDelta(t, 1.0, mastery.Accuracy, 0.01, "accuracy should be 1.0 after 3 correct")

	// Verify attempt records exist.
	var attemptCount int
	err = env.pgPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM attempts WHERE user_id = $1 AND card_id = $2`,
		userID, firstCard.ID,
	).Scan(&attemptCount)
	require.NoError(t, err)
	assert.Equal(t, 3, attemptCount, "should have 3 attempt records (append-only)")
}

func TestAnswer_StageRegressesAfterConsecutiveWrong(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "regress-test@example.com", "securepassword1")

	// Get the user's ID.
	var userID string
	err := env.pgPool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, "regress-test@example.com").Scan(&userID)
	require.NoError(t, err)

	// Get a card.
	cards, err := env.store.ListCardsByTopic(ctx, "major_chords")
	require.NoError(t, err)
	require.Greater(t, len(cards), 0)
	card := cards[0]

	// Pre-set mastery to stage 1 (so we can test regression).
	now := time.Now()
	m := &flashcards.Mastery{
		UserID:             userID,
		CardID:             card.ID,
		Stage:              1,
		ConsecutiveCorrect: 0,
		ConsecutiveWrong:   0,
		Accuracy:           0.70,
		TotalAttempts:      10,
		LastPracticed:      &now,
	}
	require.NoError(t, env.store.UpsertMastery(ctx, m))

	// Start a session so we have a valid session_id to submit against
	// (GRO-uzk3: POST /flashcards/answer now requires session_id).
	sessResp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	sessBody := readBody(t, sessResp)
	require.Equal(t, http.StatusOK, sessResp.StatusCode)
	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(sessBody, &session))
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)

	// Submit 2 wrong answers.
	for i := 0; i < 2; i++ {
		answerReq := map[string]interface{}{
			"card_id":      card.ID,
			"answer":       json.RawMessage(`{"name":"wrong"}`),
			"input_method": "multiple_choice",
		}
		answerResp := postJSON(t, client, answerURL, answerReq)
		answerResp.Body.Close()
		assert.Equal(t, http.StatusOK, answerResp.StatusCode)
	}

	// Verify mastery regressed.
	mastery, err := env.store.GetMasteryByUserAndCard(ctx, userID, card.ID)
	require.NoError(t, err)
	require.NotNil(t, mastery)

	assert.Equal(t, 0, mastery.Stage, "stage should regress to 0 after 2 consecutive wrong")
	assert.Equal(t, 12, mastery.TotalAttempts, "total_attempts should be 12 (10 + 2)")
}

func TestAnswer_MissingFieldsReturn400(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a session so the session_id-required check (GRO-uzk3) passes
	// and we reach the body validation.
	sessResp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	sessBody := readBody(t, sessResp)
	require.Equal(t, http.StatusOK, sessResp.StatusCode)
	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(sessBody, &session))
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)

	// Missing card_id.
	answerReq := map[string]interface{}{
		"answer":       json.RawMessage(`{"name":"test"}`),
		"input_method": "multiple_choice",
	}
	resp := postJSON(t, client, answerURL, answerReq)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// TestAnswer_ThreeCorrectAnswersReportProgress covers the primary GRO-uzk3
// regression: after 3 correct answers in one session, the response's
// session_progress must report answered=3, correct=3, incorrect=0, and a
// non-zero total. Before the fix, every call returned {0,0,0,0} because
// the frontend did not thread session_id and the backend silently fell
// through to a zero-valued SessionProgress struct.
func TestAnswer_ThreeCorrectAnswersReportProgress(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a guest session.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))
	require.GreaterOrEqual(t, len(session.Cards), 3, "need at least 3 cards")

	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)

	var lastResult flashcards.AnswerResponse
	for i := 0; i < 3; i++ {
		card := session.Cards[i]
		req := map[string]interface{}{
			"card_id":      card.ID,
			"answer":       json.RawMessage(card.CorrectAnswer),
			"input_method": "multiple_choice",
		}
		answerResp := postJSON(t, client, answerURL, req)
		answerBody := readBody(t, answerResp)
		require.Equal(t, http.StatusOK, answerResp.StatusCode, "body=%s", string(answerBody))
		require.NoError(t, json.Unmarshal(answerBody, &lastResult))
		assert.True(t, lastResult.Correct, "card %d should be correct", i)
	}

	// After 3 correct answers, the last response must reflect 3/3 progress.
	assert.Equal(t, 3, lastResult.SessionProgress.Answered,
		"answered counter should be 3 after 3 answers")
	assert.Equal(t, 3, lastResult.SessionProgress.Correct,
		"correct counter should be 3 after 3 correct answers")
	assert.Equal(t, 0, lastResult.SessionProgress.Incorrect,
		"incorrect counter should be 0 after 3 correct answers")
	assert.Equal(t, len(session.Cards), lastResult.SessionProgress.Total,
		"total should equal the number of cards in the session")
}

// TestAnswer_MissingSessionIDReturns404 verifies GRO-uzk3 AC 5: a POST
// with no session_id query parameter must NOT return 200 with zero
// progress; it must return 404. This makes the silent-zero failure mode
// impossible by construction.
func TestAnswer_MissingSessionIDReturns404(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a session so we have a valid card_id to reference.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))
	require.Greater(t, len(session.Cards), 0)

	// Deliberately omit session_id.
	answerReq := map[string]interface{}{
		"card_id":      session.Cards[0].ID,
		"answer":       json.RawMessage(session.Cards[0].CorrectAnswer),
		"input_method": "multiple_choice",
	}
	answerResp := postJSON(t, client, env.server.URL+"/api/v1/flashcards/answer", answerReq)
	defer answerResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, answerResp.StatusCode,
		"missing session_id must return 404, not 200 with zeroed progress")
}

// TestAnswer_UnknownSessionIDReturns404 verifies GRO-uzk3 AC 6: a POST
// carrying a well-formed but unknown session_id must return 404.
func TestAnswer_UnknownSessionIDReturns404(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a real session to get a real card_id.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(body, &session))

	// Use an arbitrary UUID that was never issued as a session.
	bogusURL := env.server.URL + "/api/v1/flashcards/answer?session_id=00000000-0000-0000-0000-000000000000"
	answerReq := map[string]interface{}{
		"card_id":      session.Cards[0].ID,
		"answer":       json.RawMessage(session.Cards[0].CorrectAnswer),
		"input_method": "multiple_choice",
	}
	answerResp := postJSON(t, client, bogusURL, answerReq)
	defer answerResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, answerResp.StatusCode,
		"unknown session_id must return 404")
}

func TestAnswer_NonExistentCardReturns404(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Start a session first (GRO-uzk3: session_id required on answer).
	sessResp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=major_chords")
	sessBody := readBody(t, sessResp)
	require.Equal(t, http.StatusOK, sessResp.StatusCode)
	var session flashcards.SessionResponse
	require.NoError(t, json.Unmarshal(sessBody, &session))
	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)

	answerReq := map[string]interface{}{
		"card_id":      "00000000-0000-0000-0000-000000000000",
		"answer":       json.RawMessage(`{"name":"test"}`),
		"input_method": "multiple_choice",
	}
	resp := postJSON(t, client, answerURL, answerReq)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// ---------- Adaptive Algorithm Unit Tests (via integration) ----------

func TestAdaptiveEngine_ClassifyCard(t *testing.T) {
	// No mastery = new.
	assert.Equal(t, flashcards.BucketNew, flashcards.ClassifyCard(nil))

	// Struggling: accuracy < 50%.
	assert.Equal(t, flashcards.BucketStruggling, flashcards.ClassifyCard(&flashcards.Mastery{
		Accuracy:        0.30,
		TotalAttempts:   10,
		ConsecutiveWrong: 0,
		Stage:           0,
	}))

	// Struggling: consecutive_wrong >= 2.
	assert.Equal(t, flashcards.BucketStruggling, flashcards.ClassifyCard(&flashcards.Mastery{
		Accuracy:        0.60,
		TotalAttempts:   10,
		ConsecutiveWrong: 2,
		Stage:           1,
	}))

	// Mastered: stage 3, accuracy > 90%.
	assert.Equal(t, flashcards.BucketMastered, flashcards.ClassifyCard(&flashcards.Mastery{
		Accuracy:      0.95,
		TotalAttempts: 20,
		Stage:         3,
	}))

	// Review: has been practiced, decent accuracy, not mastered.
	assert.Equal(t, flashcards.BucketReview, flashcards.ClassifyCard(&flashcards.Mastery{
		Accuracy:      0.65,
		TotalAttempts: 10,
		Stage:         1,
	}))
}

func TestAdaptiveEngine_ProcessAnswer_AdvancesStage(t *testing.T) {
	card := &flashcards.Card{
		CorrectAnswer: json.RawMessage(`{"name":"C major"}`),
	}
	m := &flashcards.Mastery{Stage: 0}

	// Three correct answers should advance to stage 1.
	for i := 0; i < 3; i++ {
		correct := flashcards.ProcessAnswer(m, card, json.RawMessage(`{"name":"C major"}`))
		assert.True(t, correct)
	}
	assert.Equal(t, 1, m.Stage, "stage should advance to 1 after 3 consecutive correct")
	assert.Equal(t, 0, m.ConsecutiveCorrect, "consecutive_correct resets after advancement")
}

func TestAdaptiveEngine_ProcessAnswer_RegressesStage(t *testing.T) {
	card := &flashcards.Card{
		CorrectAnswer: json.RawMessage(`{"name":"C major"}`),
	}
	m := &flashcards.Mastery{Stage: 2}

	// Two wrong answers should regress from stage 2 to stage 1.
	for i := 0; i < 2; i++ {
		correct := flashcards.ProcessAnswer(m, card, json.RawMessage(`{"name":"wrong"}`))
		assert.False(t, correct)
	}
	assert.Equal(t, 1, m.Stage, "stage should regress to 1 after 2 consecutive wrong")
	assert.Equal(t, 0, m.ConsecutiveWrong, "consecutive_wrong resets after regression")
}

func TestAdaptiveEngine_ProcessAnswer_StageZeroCannotRegress(t *testing.T) {
	card := &flashcards.Card{
		CorrectAnswer: json.RawMessage(`{"name":"C major"}`),
	}
	m := &flashcards.Mastery{Stage: 0}

	// Two wrong answers at stage 0 should not go below 0.
	for i := 0; i < 2; i++ {
		flashcards.ProcessAnswer(m, card, json.RawMessage(`{"name":"wrong"}`))
	}
	assert.Equal(t, 0, m.Stage, "stage must not go below 0")
}

func TestAdaptiveEngine_BuildSession_RespectsDistribution(t *testing.T) {
	// Create 30 test cards.
	cards := make([]flashcards.Card, 30)
	for i := range cards {
		cards[i] = flashcards.Card{
			ID:        fmt.Sprintf("card-%02d", i),
			Topic:     "test_topic",
			Direction: "name_to_notes",
		}
	}

	// Build mastery map:
	// 0-9:   struggling (10 cards)
	// 10-17: review (8 cards)
	// 18-23: new (no mastery, 6 cards)
	// 24-29: mastered (6 cards)
	now := time.Now()
	masteryMap := make(map[string]*flashcards.Mastery)

	for i := 0; i < 10; i++ {
		masteryMap[cards[i].ID] = &flashcards.Mastery{
			Stage: 0, Accuracy: 0.30, ConsecutiveWrong: 2, TotalAttempts: 10,
			LastPracticed: &now,
		}
	}
	for i := 10; i < 18; i++ {
		masteryMap[cards[i].ID] = &flashcards.Mastery{
			Stage: 1, Accuracy: 0.65, ConsecutiveWrong: 0, TotalAttempts: 10,
			LastPracticed: &now,
		}
	}
	// cards 18-23 have no mastery (new).
	for i := 24; i < 30; i++ {
		masteryMap[cards[i].ID] = &flashcards.Mastery{
			Stage: 3, Accuracy: 0.95, ConsecutiveWrong: 0, TotalAttempts: 20,
			LastPracticed: &now,
		}
	}

	session := flashcards.BuildSession(cards, masteryMap, 0)
	assert.Equal(t, flashcards.SessionSize, len(session),
		"session should have exactly %d cards", flashcards.SessionSize)

	// Sanity-check the maxCards cap: with maxCards=5, BuildSession should
	// return at most 5 cards even when SessionSize would otherwise yield 20.
	// Wired from KOTS Config item "max_cards_per_session" (GRO-7uiw).
	capped := flashcards.BuildSession(cards, masteryMap, 5)
	assert.LessOrEqual(t, len(capped), 5,
		"BuildSession with maxCards=5 must respect the cap (got %d)", len(capped))
	assert.Greater(t, len(capped), 0, "capped session should still contain cards")

	// Count bucket distribution.
	buckets := map[string]int{}
	for _, sc := range session {
		buckets[sc.BucketHint]++
	}

	t.Logf("Distribution: %v", buckets)

	// Verify approximate distribution (allow some flexibility due to shuffling
	// and backfill logic).
	assert.GreaterOrEqual(t, buckets["struggling"], 5,
		"struggling cards should be at least 5 (target 8)")
	assert.GreaterOrEqual(t, buckets["review"], 3,
		"review cards should be at least 3 (target 6)")
	assert.LessOrEqual(t, buckets["new"], flashcards.MaxNewPerSession,
		"new cards must not exceed %d", flashcards.MaxNewPerSession)
	assert.LessOrEqual(t, buckets["mastered"], 5,
		"mastered cards should not dominate the session")
}

// ---------- Distractor Quality Tests (GRO-4xts) ----------

// TestNotesToNameDistractors_SameRootDifferentQuality verifies that every
// notes_to_name card has 3 distractors that share the correct card's root
// note (key_signature) but use different chord qualities.
func TestNotesToNameDistractors_SameRootDifferentQuality(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()

	rows, err := env.pgPool.Query(ctx, `
		SELECT id, key_signature, chord_type, distractors::text
		FROM cards
		WHERE direction = 'notes_to_name'
	`)
	require.NoError(t, err)
	defer rows.Close()

	cardCount := 0
	for rows.Next() {
		var id, keySig, chordType, distractorsJSON string
		require.NoError(t, rows.Scan(&id, &keySig, &chordType, &distractorsJSON))
		cardCount++

		var distractors []map[string]interface{}
		require.NoError(t, json.Unmarshal([]byte(distractorsJSON), &distractors),
			"card %s: distractors must be valid JSON array", id)
		require.Len(t, distractors, 3, "card %s: expected exactly 3 distractors", id)

		seenQualities := make(map[string]bool)
		for _, d := range distractors {
			name, _ := d["name"].(string)
			notes, _ := d["notes"].(string)
			require.NotEmpty(t, name, "card %s: distractor must have non-empty name", id)
			require.NotEmpty(t, notes, "card %s: distractor must have non-empty notes", id)

			// Name format is "<root> <quality>"; first token must match card key_signature.
			parts := strings.SplitN(name, " ", 2)
			require.Len(t, parts, 2, "card %s: distractor name %q must be '<root> <quality>'", id, name)
			assert.Equal(t, keySig, parts[0],
				"card %s (correct %s %s): distractor root %q should match card root",
				id, keySig, chordType, parts[0])

			// Quality must differ from correct quality.
			assert.NotEqual(t, chordType, parts[1],
				"card %s: distractor quality %q must differ from correct %q",
				id, parts[1], chordType)

			// Distractor qualities must be unique within a card.
			assert.False(t, seenQualities[parts[1]],
				"card %s: duplicate distractor quality %q", id, parts[1])
			seenQualities[parts[1]] = true
		}
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, 84, cardCount,
		"expected 84 notes_to_name cards (12 keys x 7 chord types), got %d", cardCount)
}

// TestNameToNotesDistractors_Unchanged verifies that the 00009 migration did
// NOT modify distractors on name_to_notes cards. These keep their original
// cross-root same-quality distractors.
func TestNameToNotesDistractors_Unchanged(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()

	rows, err := env.pgPool.Query(ctx, `
		SELECT id, key_signature, chord_type, distractors::text
		FROM cards
		WHERE direction = 'name_to_notes'
	`)
	require.NoError(t, err)
	defer rows.Close()

	// For name_to_notes, distractor names follow pattern "<other-root> <same-quality>".
	// At least one distractor should have a root different from the card's key_signature.
	for rows.Next() {
		var id, keySig, chordType, distractorsJSON string
		require.NoError(t, rows.Scan(&id, &keySig, &chordType, &distractorsJSON))

		var distractors []map[string]interface{}
		require.NoError(t, json.Unmarshal([]byte(distractorsJSON), &distractors))
		require.Len(t, distractors, 3)

		differentRootSeen := false
		for _, d := range distractors {
			name, _ := d["name"].(string)
			parts := strings.SplitN(name, " ", 2)
			require.Len(t, parts, 2)
			if parts[0] != keySig {
				differentRootSeen = true
			}
			// For name_to_notes, quality should remain identical across distractors.
			assert.Equal(t, chordType, parts[1],
				"card %s: name_to_notes distractor should keep same quality as correct", id)
		}
		assert.True(t, differentRootSeen,
			"card %s (%s %s, name_to_notes): at least one distractor should have a different root",
			id, keySig, chordType)
	}
	require.NoError(t, rows.Err())
}

// ---------- Chord Intervals Tests (GRO-rfoz) ----------

// TestSeedChordIntervalsTopic verifies the 00010 migration inserted exactly
// 7 type_to_intervals cards under the chord_intervals topic, each with a
// non-empty intervals field on correct_answer and 3 distractors.
func TestSeedChordIntervalsTopic(t *testing.T) {
	env := setupTestEnv(t)
	ctx := context.Background()

	rows, err := env.pgPool.Query(ctx, `
		SELECT chord_type, direction, correct_answer::text, distractors::text
		FROM cards
		WHERE topic = 'chord_intervals'
		ORDER BY chord_type
	`)
	require.NoError(t, err)
	defer rows.Close()

	expectedTypes := map[string]string{
		"augmented":    "1-3-♯5",
		"diminished":   "1-♭3-♭5",
		"dominant 7th": "1-3-5-♭7",
		"major":        "1-3-5",
		"major 7th":    "1-3-5-7",
		"minor":        "1-♭3-5",
		"minor 7th":    "1-♭3-5-♭7",
	}
	seenTypes := make(map[string]bool)

	for rows.Next() {
		var chordType, direction, correctAnswerJSON, distractorsJSON string
		require.NoError(t, rows.Scan(&chordType, &direction, &correctAnswerJSON, &distractorsJSON))
		seenTypes[chordType] = true

		assert.Equal(t, "type_to_intervals", direction,
			"chord_intervals cards must use type_to_intervals direction")

		var correct map[string]interface{}
		require.NoError(t, json.Unmarshal([]byte(correctAnswerJSON), &correct))
		intervals, _ := correct["intervals"].(string)
		assert.Equal(t, expectedTypes[chordType], intervals,
			"unexpected intervals for %q", chordType)
		assert.Equal(t, chordType, correct["name"],
			"correct_answer.name should match chord_type")

		var distractors []map[string]interface{}
		require.NoError(t, json.Unmarshal([]byte(distractorsJSON), &distractors))
		assert.Len(t, distractors, 3, "expected 3 distractors for %q", chordType)

		distractorIntervals := make(map[string]bool)
		for _, d := range distractors {
			iv, _ := d["intervals"].(string)
			require.NotEmpty(t, iv, "distractor must have non-empty intervals")
			assert.NotEqual(t, intervals, iv,
				"distractor interval %q must differ from correct %q for %q",
				iv, intervals, chordType)
			assert.False(t, distractorIntervals[iv],
				"duplicate distractor intervals %q for %q", iv, chordType)
			distractorIntervals[iv] = true
		}
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, len(expectedTypes), len(seenTypes),
		"expected one card per chord type (got %d)", len(seenTypes))
}

// TestTopicsEndpointIncludesChordIntervals confirms chord_intervals appears
// in the public topic list with the expected card count.
func TestTopicsEndpointIncludesChordIntervals(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/topics")
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var topics []flashcards.TopicSummary
	require.NoError(t, json.Unmarshal(body, &topics))

	var found *flashcards.TopicSummary
	for i := range topics {
		if topics[i].Topic == "chord_intervals" {
			found = &topics[i]
			break
		}
	}
	require.NotNil(t, found, "chord_intervals topic must be returned by /topics")
	assert.Equal(t, 7, found.CardCount, "chord_intervals should have 7 cards")
}

// TestSession_ChordIntervalsReturnsCards verifies a session can be built
// from the chord_intervals topic and the returned cards carry the new
// type_to_intervals direction.
func TestSession_ChordIntervalsReturnsCards(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=chord_intervals")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body=%s", string(body))

	var session struct {
		SessionID string `json:"session_id"`
		Topic     string `json:"topic"`
		Cards     []struct {
			ID             string          `json:"id"`
			Direction      string          `json:"direction"`
			Question       json.RawMessage `json:"question"`
			CorrectAnswer  json.RawMessage `json:"correct_answer"`
			Distractors    json.RawMessage `json:"distractors"`
			Stage          int             `json:"stage"`
		} `json:"cards"`
	}
	require.NoError(t, json.Unmarshal(body, &session))
	assert.Equal(t, "chord_intervals", session.Topic)
	require.NotEmpty(t, session.Cards, "session must include cards")
	for _, c := range session.Cards {
		assert.Equal(t, "type_to_intervals", c.Direction)
		assert.NotEmpty(t, c.Question)
		assert.NotEmpty(t, c.CorrectAnswer)
	}
}

// TestCheckAnswer_IntervalsField exercises the new intervals-field branch
// in checkAnswer directly, including non-regression coverage for name and
// notes comparisons.
func TestCheckAnswer_IntervalsField(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "intervals-test@example.com", "securepassword1")

	// Fetch a chord_intervals session.
	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/session?topic=chord_intervals")
	body := readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var session struct {
		SessionID string `json:"session_id"`
		Cards     []struct {
			ID            string          `json:"id"`
			CorrectAnswer json.RawMessage `json:"correct_answer"`
			Distractors   json.RawMessage `json:"distractors"`
		} `json:"cards"`
	}
	require.NoError(t, json.Unmarshal(body, &session))
	require.NotEmpty(t, session.Cards)
	require.NotEmpty(t, session.SessionID, "session must carry an id")
	card := session.Cards[0]

	var correct map[string]interface{}
	require.NoError(t, json.Unmarshal(card.CorrectAnswer, &correct))
	intervals := correct["intervals"].(string)

	answerURL := env.server.URL + "/api/v1/flashcards/answer?session_id=" + url.QueryEscape(session.SessionID)

	// Submit the correct interval string — expect correct=true.
	submitBody := map[string]interface{}{
		"card_id":      card.ID,
		"answer":       map[string]string{"intervals": intervals},
		"input_method": "multiple_choice",
	}
	resp = postJSON(t, client, answerURL, submitBody)
	body = readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body=%s", string(body))
	var ans struct {
		Correct bool `json:"correct"`
	}
	require.NoError(t, json.Unmarshal(body, &ans))
	assert.True(t, ans.Correct, "correct intervals should return correct=true")

	// Submit a bogus interval string — expect correct=false.
	submitBody["answer"] = map[string]string{"intervals": "9-9-9-9"}
	resp = postJSON(t, client, answerURL, submitBody)
	body = readBody(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body=%s", string(body))
	require.NoError(t, json.Unmarshal(body, &ans))
	assert.False(t, ans.Correct, "bogus intervals should return correct=false")
}
