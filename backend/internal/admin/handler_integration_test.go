package admin_test

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

	"github.com/adamancini/groovelab/internal/admin"
	grooveauth "github.com/adamancini/groovelab/internal/auth"
	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/adamancini/groovelab/internal/migrate"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
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
	queries    *queries.Querier
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	// Start PostgreSQL container.
	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("groovelab_admin_test"),
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

	adminHandler := admin.NewHandler(pgPool, authSystem.AB)

	// Build router.
	r := chi.NewRouter()
	r.Use(chimiddleware.Recoverer)
	r.Use(authSystem.LoadClientStateMiddleware())
	r.Use(authSystem.RememberMiddleware())

	authSystem.MountRoutes(r, "/api/v1/auth")

	r.Route("/api/v1/admin", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Use(grooveauth.RequireAdmin(authSystem.AB))
		adminHandler.MountRoutes(r)
	})

	server := httptest.NewServer(r)
	t.Cleanup(func() { server.Close() })

	return &testEnv{
		pgPool:     pgPool,
		rdClient:   rdClient,
		server:     server,
		authSystem: authSystem,
		queries:    queries.New(pgPool),
	}
}

// newClientWithCookies creates an HTTP client that stores cookies.
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

func postJSON(t *testing.T, client *http.Client, url string, body map[string]string) *http.Response {
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

func readBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return body
}

// registerAndLogin registers a user and logs them in, returning the client.
func registerAndLogin(t *testing.T, baseURL, email, password string) *http.Client {
	t.Helper()
	client := newClientWithCookies(t)

	resp := postJSON(t, client, baseURL+"/api/v1/auth/register", map[string]string{
		"email":    email,
		"password": password,
	})
	resp.Body.Close()

	resp = postJSON(t, client, baseURL+"/api/v1/auth/login", map[string]string{
		"email":    email,
		"password": password,
	})
	resp.Body.Close()

	return client
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	u, err := url.Parse(rawURL)
	require.NoError(t, err)
	return u
}

// createTrackForUser inserts a track directly into the database for a given user.
func createTrackForUser(t *testing.T, q *queries.Querier, userID, name string, numChords int) *queries.Track {
	t.Helper()
	chords := make([]string, numChords)
	for i := range chords {
		chords[i] = `"C"`
	}
	chordJSON, _ := json.Marshal(chords)
	track, err := q.CreateTrack(context.Background(), userID, name, chordJSON, json.RawMessage("{}"), 120, json.RawMessage("{}"))
	require.NoError(t, err)
	return track
}

// --- Tests ---

// TestListUsers_AdminRequired verifies that only admin users can list users.
func TestListUsers_AdminRequired(t *testing.T) {
	env := setupTestEnv(t)

	// Register admin (first user) and regular user.
	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	userClient := registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	// Non-admin should get 403.
	resp, err := userClient.Get(env.server.URL + "/api/v1/admin/users")
	require.NoError(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	resp.Body.Close()

	// Admin should get 200 with user list.
	resp, err = adminClient.Get(env.server.URL + "/api/v1/admin/users")
	require.NoError(t, err)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var users []map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &users))
	assert.Len(t, users, 2, "should return both users")

	// Verify user fields.
	for _, u := range users {
		assert.NotEmpty(t, u["id"])
		assert.NotEmpty(t, u["email"])
		assert.NotEmpty(t, u["role"])
		assert.NotEmpty(t, u["created_at"])
		assert.NotEmpty(t, u["updated_at"])
		assert.NotNil(t, u["enabled"])
	}
}

// TestListUsers_Unauthenticated verifies that unauthenticated requests get 401.
func TestListUsers_Unauthenticated(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/admin/users")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

// TestUpdateUser_ChangeRole verifies admins can change a user's role.
func TestUpdateUser_ChangeRole(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	_ = registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	// Get user list to find the regular user's ID.
	resp, err := adminClient.Get(env.server.URL + "/api/v1/admin/users")
	require.NoError(t, err)
	body := readBody(t, resp)

	var users []map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &users))

	var regularUserID string
	for _, u := range users {
		if u["email"] == "user@test.com" {
			regularUserID = u["id"].(string)
			break
		}
	}
	require.NotEmpty(t, regularUserID)

	// Promote user to admin.
	role := "admin"
	resp = putJSON(t, adminClient, env.server.URL+"/api/v1/admin/users/"+regularUserID, map[string]*string{
		"role": &role,
	})
	body = readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var updated map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &updated))
	assert.Equal(t, "admin", updated["role"])
}

// TestUpdateUser_ToggleEnabled verifies admins can enable/disable users.
func TestUpdateUser_ToggleEnabled(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	_ = registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	// Get the regular user's ID.
	resp, err := adminClient.Get(env.server.URL + "/api/v1/admin/users")
	require.NoError(t, err)
	body := readBody(t, resp)

	var users []map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &users))

	var regularUserID string
	for _, u := range users {
		if u["email"] == "user@test.com" {
			regularUserID = u["id"].(string)
			break
		}
	}
	require.NotEmpty(t, regularUserID)

	// Disable user.
	enabled := false
	resp = putJSON(t, adminClient, env.server.URL+"/api/v1/admin/users/"+regularUserID, map[string]*bool{
		"enabled": &enabled,
	})
	body = readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var updated map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &updated))
	assert.Equal(t, false, updated["enabled"])
}

// TestUpdateUser_CannotDisableSelf verifies that admins cannot disable their own account.
func TestUpdateUser_CannotDisableSelf(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")

	// Get admin user ID.
	adminUser, err := env.queries.GetUserByEmail(context.Background(), "admin@test.com")
	require.NoError(t, err)
	require.NotNil(t, adminUser)

	// Try to disable self.
	enabled := false
	resp := putJSON(t, adminClient, env.server.URL+"/api/v1/admin/users/"+adminUser.ID, map[string]*bool{
		"enabled": &enabled,
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)

	var errResp map[string]string
	require.NoError(t, json.Unmarshal(body, &errResp))
	assert.Contains(t, errResp["error"], "cannot disable your own account")
}

// TestUpdateUser_InvalidRole verifies that invalid role values are rejected.
func TestUpdateUser_InvalidRole(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	_ = registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	user, err := env.queries.GetUserByEmail(context.Background(), "user@test.com")
	require.NoError(t, err)

	badRole := "superadmin"
	resp := putJSON(t, adminClient, env.server.URL+"/api/v1/admin/users/"+user.ID, map[string]*string{
		"role": &badRole,
	})
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// TestUpdateUser_NotFound verifies 404 for nonexistent user.
func TestUpdateUser_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")

	role := "admin"
	resp := putJSON(t, adminClient, env.server.URL+"/api/v1/admin/users/00000000-0000-0000-0000-000000000000", map[string]*string{
		"role": &role,
	})
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

// TestListTracks_AdminReturnsAllWithEmail verifies admin track listing includes user_email and chord_count.
func TestListTracks_AdminReturnsAllWithEmail(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	_ = registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	// Get user IDs.
	adminUser, err := env.queries.GetUserByEmail(context.Background(), "admin@test.com")
	require.NoError(t, err)
	regularUser, err := env.queries.GetUserByEmail(context.Background(), "user@test.com")
	require.NoError(t, err)

	// Create tracks.
	createTrackForUser(t, env.queries, adminUser.ID, "Admin Track", 3)
	createTrackForUser(t, env.queries, regularUser.ID, "User Track", 5)

	// List tracks as admin.
	resp, err := adminClient.Get(env.server.URL + "/api/v1/admin/tracks")
	require.NoError(t, err)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var tracks []map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &tracks))
	assert.Len(t, tracks, 2, "admin should see all tracks")

	// Verify required fields.
	for _, tr := range tracks {
		assert.NotEmpty(t, tr["id"])
		assert.NotEmpty(t, tr["name"])
		assert.NotEmpty(t, tr["user_id"])
		assert.NotEmpty(t, tr["user_email"])
		assert.NotNil(t, tr["chord_count"])
		assert.NotEmpty(t, tr["created_at"])
	}

	// Verify chord counts.
	for _, tr := range tracks {
		name := tr["name"].(string)
		chordCount := int(tr["chord_count"].(float64))
		switch name {
		case "Admin Track":
			assert.Equal(t, 3, chordCount)
			assert.Equal(t, "admin@test.com", tr["user_email"])
		case "User Track":
			assert.Equal(t, 5, chordCount)
			assert.Equal(t, "user@test.com", tr["user_email"])
		}
	}
}

// TestListTracks_NonAdminForbidden verifies non-admins cannot list admin tracks.
func TestListTracks_NonAdminForbidden(t *testing.T) {
	env := setupTestEnv(t)

	_ = registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	userClient := registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	resp, err := userClient.Get(env.server.URL + "/api/v1/admin/tracks")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

// TestDeleteTrack_AdminCanDeleteAnyTrack verifies admin can delete any user's track.
func TestDeleteTrack_AdminCanDeleteAnyTrack(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")
	_ = registerAndLogin(t, env.server.URL, "user@test.com", "securepassword2")

	regularUser, err := env.queries.GetUserByEmail(context.Background(), "user@test.com")
	require.NoError(t, err)

	track := createTrackForUser(t, env.queries, regularUser.ID, "To Delete", 2)

	// Delete the track as admin.
	resp := doDelete(t, adminClient, env.server.URL+"/api/v1/admin/tracks/"+track.ID)
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	resp.Body.Close()

	// Verify the track is gone.
	gone, err := env.queries.GetTrackByID(context.Background(), track.ID)
	require.NoError(t, err)
	assert.Nil(t, gone, "track should be deleted")
}

// TestDeleteTrack_NotFound verifies 404 for nonexistent track.
func TestDeleteTrack_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	adminClient := registerAndLogin(t, env.server.URL, "admin@test.com", "securepassword1")

	resp := doDelete(t, adminClient, env.server.URL+"/api/v1/admin/tracks/00000000-0000-0000-0000-000000000000")
	body := readBody(t, resp)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)

	var errResp map[string]string
	require.NoError(t, json.Unmarshal(body, &errResp))
	assert.Equal(t, "track not found", errResp["error"])
}

// Ensure the url import is used.
var _ = mustParseURL
