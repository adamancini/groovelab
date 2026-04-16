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

	expected := []string{
		"augmented_chords", "diminished_chords", "dominant_7th_chords",
		"major_7th_chords", "major_chords", "minor_7th_chords", "minor_chords",
	}
	assert.Equal(t, expected, topics, "all 7 chord type topics must be present")
}

// ---------- Topics Endpoint Tests ----------

func TestTopics_GuestReturnsTopicsWithoutMastery(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/topics")
	body := readBody(t, resp)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var topics []flashcards.TopicSummary
	require.NoError(t, json.Unmarshal(body, &topics))
	assert.Len(t, topics, 7, "should return 7 topics")

	for _, ts := range topics {
		assert.Greater(t, ts.CardCount, 0, "each topic must have cards")
		// Guest: mastery fields should be nil.
		assert.Nil(t, ts.MasteryPct, "guest topics should not include mastery_pct")
		assert.Nil(t, ts.PracticedCount, "guest topics should not include practiced_count")
	}
}

func TestTopics_AuthenticatedReturnsTopicsWithMastery(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "topics-test@example.com", "securepassword1")

	resp := getJSON(t, client, env.server.URL+"/api/v1/flashcards/topics")
	body := readBody(t, resp)

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var topics []flashcards.TopicSummary
	require.NoError(t, json.Unmarshal(body, &topics))
	assert.Len(t, topics, 7, "should return 7 topics")

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
	for i := 0; i < 3; i++ {
		answerReq := map[string]interface{}{
			"card_id":      firstCard.ID,
			"answer":       json.RawMessage(firstCard.CorrectAnswer),
			"input_method": "multiple_choice",
		}
		answerResp := postJSON(t, client, env.server.URL+"/api/v1/flashcards/answer", answerReq)
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

	// Submit 2 wrong answers.
	for i := 0; i < 2; i++ {
		answerReq := map[string]interface{}{
			"card_id":      card.ID,
			"answer":       json.RawMessage(`{"name":"wrong"}`),
			"input_method": "multiple_choice",
		}
		answerResp := postJSON(t, client, env.server.URL+"/api/v1/flashcards/answer", answerReq)
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

	// Missing card_id.
	answerReq := map[string]interface{}{
		"answer":       json.RawMessage(`{"name":"test"}`),
		"input_method": "multiple_choice",
	}
	resp := postJSON(t, client, env.server.URL+"/api/v1/flashcards/answer", answerReq)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

func TestAnswer_NonExistentCardReturns404(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	answerReq := map[string]interface{}{
		"card_id":      "00000000-0000-0000-0000-000000000000",
		"answer":       json.RawMessage(`{"name":"test"}`),
		"input_method": "multiple_choice",
	}
	resp := postJSON(t, client, env.server.URL+"/api/v1/flashcards/answer", answerReq)
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

	session := flashcards.BuildSession(cards, masteryMap)
	assert.Equal(t, flashcards.SessionSize, len(session),
		"session should have exactly %d cards", flashcards.SessionSize)

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
