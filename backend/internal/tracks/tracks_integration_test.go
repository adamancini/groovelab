package tracks_test

import (
	"bytes"
	"context"
	"encoding/json"
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
	"github.com/adamancini/groovelab/internal/migrate"
	"github.com/adamancini/groovelab/internal/progress"
	"github.com/adamancini/groovelab/internal/tracks"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// testEnv holds shared test infrastructure.
type testEnv struct {
	pgPool     *pgxpool.Pool
	rdClient   *redis.Client
	server     *httptest.Server
	authSystem *grooveauth.Auth
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	// Start PostgreSQL container.
	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("groovelab_tracks_test"),
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

	// Run migrations.
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

	trackHandler := tracks.NewHandler(pgPool, authSystem.AB)
	progressHandler := progress.NewHandler(pgPool, authSystem.AB)

	// Build router.
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(authSystem.LoadClientStateMiddleware())
	r.Use(authSystem.RememberMiddleware())

	// Mount auth routes.
	authSystem.MountRoutes(r, "/api/v1/auth")

	// Mount track routes (authenticated).
	r.Route("/api/v1/tracks", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		trackHandler.MountRoutes(r)
	})

	// Mount progress routes (authenticated).
	r.Route("/api/v1/progress", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		progressHandler.MountRoutes(r)
	})

	// Mount admin routes.
	r.Route("/api/v1/admin", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Use(grooveauth.RequireAdmin(authSystem.AB))
		r.Route("/tracks", func(r chi.Router) {
			trackHandler.MountAdminRoutes(r)
		})
	})

	server := httptest.NewServer(r)
	t.Cleanup(func() { server.Close() })

	return &testEnv{
		pgPool:     pgPool,
		rdClient:   rdClient,
		server:     server,
		authSystem: authSystem,
	}
}

// --- Helper functions ---

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

func postJSON(t *testing.T, client *http.Client, url string, body interface{}) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	require.NoError(t, err)
	resp, err := client.Post(url, "application/json", bytes.NewReader(data))
	require.NoError(t, err)
	return resp
}

func putJSON(t *testing.T, client *http.Client, url string, body interface{}) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(data))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

func doDelete(t *testing.T, client *http.Client, url string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, url, nil)
	require.NoError(t, err)
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

func readBody(t *testing.T, resp *http.Response) map[string]interface{} {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	var result map[string]interface{}
	_ = json.Unmarshal(body, &result)
	return result
}

func readBodyRaw(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return body
}

func registerUser(t *testing.T, client *http.Client, baseURL, email, password string) *http.Response {
	t.Helper()
	return postJSON(t, client, baseURL+"/api/v1/auth/register", map[string]string{
		"email":    email,
		"password": password,
	})
}

func loginUser(t *testing.T, client *http.Client, baseURL, email, password string) *http.Response {
	t.Helper()
	return postJSON(t, client, baseURL+"/api/v1/auth/login", map[string]string{
		"email":    email,
		"password": password,
	})
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	u, err := url.Parse(rawURL)
	require.NoError(t, err)
	return u
}

// registerAndLogin creates a user and logs in, returning the authenticated client.
func registerAndLogin(t *testing.T, baseURL, email, password string) *http.Client {
	t.Helper()
	client := newClientWithCookies(t)
	resp := registerUser(t, client, baseURL, email, password)
	resp.Body.Close()
	loginResp := loginUser(t, client, baseURL, email, password)
	loginResp.Body.Close()
	return client
}

// --- Track CRUD Tests ---

func TestCreateTrack_Success(t *testing.T) {
	env := setupTestEnv(t)
	client := registerAndLogin(t, env.server.URL, "user1@example.com", "securepassword1")

	resp := postJSON(t, client, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "My Funk Track",
		"chord_sequence": []map[string]interface{}{{"root": "C", "type": "maj7", "duration_bars": 2}},
		"drum_pattern":   map[string]interface{}{"kick": []int{1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0}},
		"bpm":            95,
		"playback_settings": map[string]interface{}{
			"metronome": true,
			"count_in":  true,
		},
	})
	body := readBody(t, resp)

	assert.Equal(t, http.StatusCreated, resp.StatusCode, "create track should return 201")
	assert.NotEmpty(t, body["id"], "track should have an ID")
	assert.Equal(t, "My Funk Track", body["name"])
	assert.Equal(t, float64(95), body["bpm"])
	assert.NotNil(t, body["chord_sequence"])
	assert.NotNil(t, body["drum_pattern"])
	assert.NotNil(t, body["playback_settings"])
	assert.NotEmpty(t, body["created_at"])
	assert.NotEmpty(t, body["updated_at"])
}

func TestCreateTrack_GuestReturns401(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := postJSON(t, client, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name": "Should Fail",
		"bpm":  120,
	})
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
		"guest should get 401 when creating a track")
}

func TestListTracks_OnlyOwned(t *testing.T) {
	env := setupTestEnv(t)

	// User1 creates two tracks.
	client1 := registerAndLogin(t, env.server.URL, "user1@example.com", "securepassword1")

	resp := postJSON(t, client1, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "Track A",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            100,
	})
	resp.Body.Close()

	resp = postJSON(t, client1, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "Track B",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            110,
	})
	resp.Body.Close()

	// User2 creates one track.
	client2 := registerAndLogin(t, env.server.URL, "user2@example.com", "securepassword2")

	resp = postJSON(t, client2, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "Track C",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            120,
	})
	resp.Body.Close()

	// User1 lists tracks -- should see only their own 2.
	listResp, err := client1.Get(env.server.URL + "/api/v1/tracks")
	require.NoError(t, err)
	listBody := readBodyRaw(t, listResp)

	var trackList []map[string]interface{}
	require.NoError(t, json.Unmarshal(listBody, &trackList))
	assert.Equal(t, 2, len(trackList), "user1 should see only their 2 tracks")

	// User2 lists tracks -- should see only their own 1.
	listResp2, err := client2.Get(env.server.URL + "/api/v1/tracks")
	require.NoError(t, err)
	listBody2 := readBodyRaw(t, listResp2)

	var trackList2 []map[string]interface{}
	require.NoError(t, json.Unmarshal(listBody2, &trackList2))
	assert.Equal(t, 1, len(trackList2), "user2 should see only their 1 track")
}

func TestGetTrack_OwnershipEnforced(t *testing.T) {
	env := setupTestEnv(t)

	// User1 creates a track.
	client1 := registerAndLogin(t, env.server.URL, "owner@example.com", "securepassword1")
	createResp := postJSON(t, client1, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "Private Track",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            80,
	})
	createBody := readBody(t, createResp)
	trackID := createBody["id"].(string)

	// User1 can access their own track.
	getResp, err := client1.Get(env.server.URL + "/api/v1/tracks/" + trackID)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, getResp.StatusCode, "owner should be able to get their track")
	getResp.Body.Close()

	// User2 cannot access User1's track.
	client2 := registerAndLogin(t, env.server.URL, "intruder@example.com", "securepassword2")
	getResp2, err := client2.Get(env.server.URL + "/api/v1/tracks/" + trackID)
	require.NoError(t, err)
	assert.Equal(t, http.StatusForbidden, getResp2.StatusCode,
		"non-owner should get 403 when accessing another user's track")
	getResp2.Body.Close()
}

func TestUpdateTrack_OwnerOnly(t *testing.T) {
	env := setupTestEnv(t)

	// User1 creates a track.
	client1 := registerAndLogin(t, env.server.URL, "updater@example.com", "securepassword1")
	createResp := postJSON(t, client1, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "Original Name",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            100,
	})
	createBody := readBody(t, createResp)
	trackID := createBody["id"].(string)

	// User1 updates their track.
	updateResp := putJSON(t, client1, env.server.URL+"/api/v1/tracks/"+trackID, map[string]interface{}{
		"name":           "Updated Name",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            110,
	})
	updateBody := readBody(t, updateResp)
	assert.Equal(t, http.StatusOK, updateResp.StatusCode, "owner should be able to update their track")
	assert.Equal(t, "Updated Name", updateBody["name"])
	assert.Equal(t, float64(110), updateBody["bpm"])

	// User2 tries to update User1's track -- gets 403.
	client2 := registerAndLogin(t, env.server.URL, "hacker@example.com", "securepassword2")
	hackerResp := putJSON(t, client2, env.server.URL+"/api/v1/tracks/"+trackID, map[string]interface{}{
		"name":           "Hacked Name",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            200,
	})
	defer hackerResp.Body.Close()
	assert.Equal(t, http.StatusForbidden, hackerResp.StatusCode,
		"non-owner should get 403 when updating another user's track")
}

func TestDeleteTrack_OwnerOnly(t *testing.T) {
	env := setupTestEnv(t)

	// User1 creates a track.
	client1 := registerAndLogin(t, env.server.URL, "deleter@example.com", "securepassword1")
	createResp := postJSON(t, client1, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "To Be Deleted",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            100,
	})
	createBody := readBody(t, createResp)
	trackID := createBody["id"].(string)

	// User2 tries to delete User1's track -- gets 403.
	client2 := registerAndLogin(t, env.server.URL, "notowner@example.com", "securepassword2")
	deleteResp := doDelete(t, client2, env.server.URL+"/api/v1/tracks/"+trackID)
	defer deleteResp.Body.Close()
	assert.Equal(t, http.StatusForbidden, deleteResp.StatusCode,
		"non-owner should get 403 when deleting another user's track")

	// User1 deletes their track -- succeeds.
	deleteResp2 := doDelete(t, client1, env.server.URL+"/api/v1/tracks/"+trackID)
	defer deleteResp2.Body.Close()
	assert.Equal(t, http.StatusNoContent, deleteResp2.StatusCode,
		"owner should be able to delete their track")

	// Verify track is gone.
	getResp, err := client1.Get(env.server.URL + "/api/v1/tracks/" + trackID)
	require.NoError(t, err)
	defer getResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, getResp.StatusCode,
		"deleted track should not be found")
}

func TestGetTrack_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	client := registerAndLogin(t, env.server.URL, "searcher@example.com", "securepassword1")

	resp, err := client.Get(env.server.URL + "/api/v1/tracks/00000000-0000-0000-0000-000000000000")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusNotFound, resp.StatusCode,
		"getting a non-existent track should return 404")
}

func TestAdminListAllTracks(t *testing.T) {
	env := setupTestEnv(t)

	// First user is admin.
	adminClient := registerAndLogin(t, env.server.URL, "admin@example.com", "securepassword1")

	// Second user creates a track.
	userClient := registerAndLogin(t, env.server.URL, "regular@example.com", "securepassword2")
	resp := postJSON(t, userClient, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "User Track",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            90,
	})
	resp.Body.Close()

	// Admin creates a track too.
	resp = postJSON(t, adminClient, env.server.URL+"/api/v1/tracks", map[string]interface{}{
		"name":           "Admin Track",
		"chord_sequence": []interface{}{},
		"drum_pattern":   map[string]interface{}{},
		"bpm":            100,
	})
	resp.Body.Close()

	// Admin can see all tracks via admin endpoint.
	adminResp, err := adminClient.Get(env.server.URL + "/api/v1/admin/tracks")
	require.NoError(t, err)
	adminBody := readBodyRaw(t, adminResp)

	var allTracks []map[string]interface{}
	require.NoError(t, json.Unmarshal(adminBody, &allTracks))
	assert.Equal(t, 2, len(allTracks), "admin should see all 2 tracks across users")

	// Non-admin cannot access admin endpoint.
	userAdminResp, err := userClient.Get(env.server.URL + "/api/v1/admin/tracks")
	require.NoError(t, err)
	defer userAdminResp.Body.Close()
	assert.Equal(t, http.StatusForbidden, userAdminResp.StatusCode,
		"non-admin should get 403 for admin tracks endpoint")
}

// --- Streak Tests ---

func TestStreakUpsert(t *testing.T) {
	env := setupTestEnv(t)
	client := registerAndLogin(t, env.server.URL, "streaker@example.com", "securepassword1")

	// Record a streak for today.
	resp := postJSON(t, client, env.server.URL+"/api/v1/progress/streaks", map[string]interface{}{
		"practice_date":          time.Now().UTC().Format("2006-01-02"),
		"session_correct_streak": 5,
		"session_best_streak":    5,
	})
	body := readBody(t, resp)

	assert.Equal(t, http.StatusOK, resp.StatusCode, "upsert streak should return 200")
	assert.Equal(t, float64(5), body["session_correct_streak"])
	assert.Equal(t, float64(5), body["session_best_streak"])

	// Update the same day with a higher streak.
	resp2 := postJSON(t, client, env.server.URL+"/api/v1/progress/streaks", map[string]interface{}{
		"practice_date":          time.Now().UTC().Format("2006-01-02"),
		"session_correct_streak": 3,
		"session_best_streak":    8,
	})
	body2 := readBody(t, resp2)

	assert.Equal(t, http.StatusOK, resp2.StatusCode)
	// session_correct_streak should be the latest value (3), but session_best_streak
	// should be the GREATEST of existing (5) and new (8) = 8.
	assert.Equal(t, float64(3), body2["session_correct_streak"])
	assert.Equal(t, float64(8), body2["session_best_streak"])

	// Update again with a lower session_best_streak -- should keep the higher one.
	resp3 := postJSON(t, client, env.server.URL+"/api/v1/progress/streaks", map[string]interface{}{
		"practice_date":          time.Now().UTC().Format("2006-01-02"),
		"session_correct_streak": 2,
		"session_best_streak":    4,
	})
	body3 := readBody(t, resp3)

	assert.Equal(t, float64(2), body3["session_correct_streak"])
	assert.Equal(t, float64(8), body3["session_best_streak"], "session_best_streak should remain at highest value")
}

func TestStreaks_GuestReturns401(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/progress/streaks")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
		"guest should get 401 for streaks endpoint")
}

func TestGetStreaks_WithMultipleDays(t *testing.T) {
	env := setupTestEnv(t)
	client := registerAndLogin(t, env.server.URL, "multiday@example.com", "securepassword1")

	today := time.Now().UTC().Truncate(24 * time.Hour)

	// Record streaks for 3 consecutive days.
	for i := 2; i >= 0; i-- {
		date := today.AddDate(0, 0, -i)
		resp := postJSON(t, client, env.server.URL+"/api/v1/progress/streaks", map[string]interface{}{
			"practice_date":          date.Format("2006-01-02"),
			"session_correct_streak": 5 + i,
			"session_best_streak":    10 + i,
		})
		resp.Body.Close()
	}

	// Get streaks.
	getResp, err := client.Get(env.server.URL + "/api/v1/progress/streaks")
	require.NoError(t, err)
	streakBody := readBody(t, getResp)

	assert.Equal(t, http.StatusOK, getResp.StatusCode)
	assert.Equal(t, float64(3), streakBody["current_daily_streak"],
		"current daily streak should be 3 after 3 consecutive days")
	assert.GreaterOrEqual(t, streakBody["best_daily_streak"].(float64), float64(3),
		"best daily streak should be at least 3")
	assert.Equal(t, float64(10), streakBody["today_session_best"],
		"today's session best should be 10")
}

// --- Dashboard Tests ---

func TestDashboard_Authenticated(t *testing.T) {
	env := setupTestEnv(t)
	client := registerAndLogin(t, env.server.URL, "dashboard@example.com", "securepassword1")

	// Record some streak data.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	resp := postJSON(t, client, env.server.URL+"/api/v1/progress/streaks", map[string]interface{}{
		"practice_date":          today.Format("2006-01-02"),
		"session_correct_streak": 7,
		"session_best_streak":    12,
	})
	resp.Body.Close()

	// Get dashboard.
	dashResp, err := client.Get(env.server.URL + "/api/v1/progress/dashboard")
	require.NoError(t, err)
	dashBody := readBody(t, dashResp)

	assert.Equal(t, http.StatusOK, dashResp.StatusCode)
	assert.NotNil(t, dashBody["overall_accuracy"], "dashboard should include overall_accuracy")
	assert.NotNil(t, dashBody["topic_accuracy"], "dashboard should include topic_accuracy")
	assert.NotNil(t, dashBody["weak_areas"], "dashboard should include weak_areas")
	assert.NotNil(t, dashBody["current_streak"], "dashboard should include current_streak")
	assert.NotNil(t, dashBody["best_streak"], "dashboard should include best_streak")
	assert.NotNil(t, dashBody["today_session_best"], "dashboard should include today_session_best")
	assert.Equal(t, float64(1), dashBody["current_streak"], "should have 1-day streak")
	assert.Equal(t, float64(12), dashBody["today_session_best"])
}

func TestDashboard_GuestReturns401(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/progress/dashboard")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
		"guest should get 401 for dashboard endpoint")
}

// Ensure the unused import for url is used
var _ = mustParseURL
