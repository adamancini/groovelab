package auth_test

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
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// testEnv holds shared test infrastructure for auth integration tests.
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
		tcpostgres.WithDatabase("groovelab_auth_test"),
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

	// Set up auth system. The test server URL will be set after creation.
	authSystem, err := grooveauth.Setup(grooveauth.Config{
		RootURL:     "http://localhost", // will be overridden
		MountPath:   "/api/v1/auth",
		Pool:        pgPool,
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

	// Build router.
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(authSystem.LoadClientStateMiddleware())
	r.Use(authSystem.RememberMiddleware())

	// Mount auth routes.
	authSystem.MountRoutes(r, "/api/v1/auth")

	// Protected route for testing auth middleware.
	r.Route("/api/v1/protected", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"protected content"}`))
		})
	})

	// Admin route for testing admin middleware.
	r.Route("/api/v1/admin", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Use(grooveauth.RequireAdmin(authSystem.AB))
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"admin area"}`))
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

// newClientWithCookies creates an HTTP client that stores cookies.
func newClientWithCookies(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	return &http.Client{
		Jar: jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Do not follow redirects automatically in tests.
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

func readBody(t *testing.T, resp *http.Response) map[string]interface{} {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	var result map[string]interface{}
	_ = json.Unmarshal(body, &result)
	return result
}

// registerUser sends a POST /api/v1/auth/register request.
func registerUser(t *testing.T, client *http.Client, baseURL, email, password string) *http.Response {
	t.Helper()
	return postJSON(t, client, baseURL+"/api/v1/auth/register", map[string]string{
		"email":    email,
		"password": password,
	})
}

// loginUser sends a POST /api/v1/auth/login request.
func loginUser(t *testing.T, client *http.Client, baseURL, email, password string) *http.Response {
	t.Helper()
	return postJSON(t, client, baseURL+"/api/v1/auth/login", map[string]string{
		"email":    email,
		"password": password,
	})
}

// logoutUser sends a POST /api/v1/auth/logout request.
func logoutUser(t *testing.T, client *http.Client, baseURL string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/auth/logout", nil)
	require.NoError(t, err)
	resp, err := client.Do(req)
	require.NoError(t, err)
	return resp
}

// TestRegistration_FirstUserIsAdmin verifies that the first registered user
// gets the admin role and subsequent users get the user role.
func TestRegistration_FirstUserIsAdmin(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Register first user -- should be admin.
	resp := registerUser(t, client, env.server.URL, "admin@example.com", "securepassword1")
	defer resp.Body.Close()
	// Authboss register returns a redirect (302 or 307) or 200 in API mode.
	assert.True(t, resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusTemporaryRedirect,
		"expected 200, 302, or 307 for first registration, got %d", resp.StatusCode)

	// Verify the user has admin role via database query.
	user, err := env.authSystem.Queries.GetUserByEmail(context.Background(), "admin@example.com")
	require.NoError(t, err, "get first user from db")
	require.NotNil(t, user, "first user must exist")
	assert.Equal(t, "admin", user.Role, "first user must have admin role")

	// Register second user -- should be regular user.
	client2 := newClientWithCookies(t)
	resp2 := registerUser(t, client2, env.server.URL, "user@example.com", "securepassword2")
	defer resp2.Body.Close()
	assert.True(t, resp2.StatusCode == http.StatusOK || resp2.StatusCode == http.StatusFound || resp2.StatusCode == http.StatusTemporaryRedirect,
		"expected 200, 302, or 307 for second registration, got %d", resp2.StatusCode)

	user2, err := env.authSystem.Queries.GetUserByEmail(context.Background(), "user@example.com")
	require.NoError(t, err, "get second user from db")
	require.NotNil(t, user2, "second user must exist")
	assert.Equal(t, "user", user2.Role, "second user must have user role")
}

// TestLogin_Session_Logout verifies the full authentication lifecycle:
// register, login, verify session, then logout.
func TestLogin_Session_Logout(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Register.
	resp := registerUser(t, client, env.server.URL, "lifecycle@example.com", "securepassword1")
	resp.Body.Close()

	// Login.
	loginResp := loginUser(t, client, env.server.URL, "lifecycle@example.com", "securepassword1")
	loginResp.Body.Close()
	assert.True(t, loginResp.StatusCode == http.StatusOK || loginResp.StatusCode == http.StatusFound || loginResp.StatusCode == http.StatusTemporaryRedirect,
		"login should succeed, got %d", loginResp.StatusCode)

	// Verify session: GET /api/v1/auth/me should return user info.
	meResp, err := client.Get(env.server.URL + "/api/v1/auth/me")
	require.NoError(t, err)
	meBody := readBody(t, meResp)
	assert.Equal(t, http.StatusOK, meResp.StatusCode, "/me should return 200 when authenticated")
	assert.Equal(t, "lifecycle@example.com", meBody["email"])
	assert.NotEmpty(t, meBody["id"], "user ID should be present")
	assert.NotEmpty(t, meBody["role"], "user role should be present")

	// Verify session exists in Redis.
	cookies := client.Jar.Cookies(mustParseURL(t, env.server.URL))
	var sessionToken string
	for _, c := range cookies {
		if c.Name == "groovelab_session" {
			sessionToken = c.Value
			break
		}
	}
	require.NotEmpty(t, sessionToken, "session cookie must be set")

	exists, err := env.rdClient.Exists(context.Background(), "session:"+sessionToken).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(1), exists, "session key must exist in Redis")

	// Logout.
	logoutResp := logoutUser(t, client, env.server.URL)
	logoutResp.Body.Close()

	// Verify session is destroyed: /me should return 401.
	meResp2, err := client.Get(env.server.URL + "/api/v1/auth/me")
	require.NoError(t, err)
	defer meResp2.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, meResp2.StatusCode, "/me should return 401 after logout")
}

// TestAuthMiddleware_BlocksUnauthenticated verifies that the auth middleware
// returns 401 for unauthenticated requests.
func TestAuthMiddleware_BlocksUnauthenticated(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/protected/")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
		"protected route must return 401 for unauthenticated requests")
}

// TestAdminMiddleware_BlocksNonAdmin verifies that the admin middleware
// returns 403 for non-admin authenticated users.
func TestAdminMiddleware_BlocksNonAdmin(t *testing.T) {
	env := setupTestEnv(t)

	// First, create an admin user.
	adminClient := newClientWithCookies(t)
	resp := registerUser(t, adminClient, env.server.URL, "first-admin@example.com", "securepassword1")
	resp.Body.Close()

	// Now create a regular user.
	userClient := newClientWithCookies(t)
	resp = registerUser(t, userClient, env.server.URL, "regular@example.com", "securepassword2")
	resp.Body.Close()

	// Login as regular user.
	loginResp := loginUser(t, userClient, env.server.URL, "regular@example.com", "securepassword2")
	loginResp.Body.Close()

	// Try to access admin route.
	adminResp, err := userClient.Get(env.server.URL + "/api/v1/admin/")
	require.NoError(t, err)
	defer adminResp.Body.Close()
	assert.Equal(t, http.StatusForbidden, adminResp.StatusCode,
		"admin route must return 403 for non-admin users")
}

// TestAdminMiddleware_AllowsAdmin verifies that admin users can access admin routes.
func TestAdminMiddleware_AllowsAdmin(t *testing.T) {
	env := setupTestEnv(t)

	// Register first user (admin).
	adminClient := newClientWithCookies(t)
	resp := registerUser(t, adminClient, env.server.URL, "theadmin@example.com", "securepassword1")
	resp.Body.Close()

	// Login as admin.
	loginResp := loginUser(t, adminClient, env.server.URL, "theadmin@example.com", "securepassword1")
	loginResp.Body.Close()

	// Access admin route.
	adminResp, err := adminClient.Get(env.server.URL + "/api/v1/admin/")
	require.NoError(t, err)
	defer adminResp.Body.Close()
	assert.Equal(t, http.StatusOK, adminResp.StatusCode,
		"admin route must return 200 for admin users")
}

// TestMe_Unauthenticated returns 401.
func TestMe_Unauthenticated(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/auth/me")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
		"GET /api/v1/auth/me must return 401 for unauthenticated requests")
}

// TestSessionCookie_Attributes verifies that the session cookie has the
// correct attributes (HttpOnly, SameSite=Lax).
func TestSessionCookie_Attributes(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Register and login to get a session cookie.
	resp := registerUser(t, client, env.server.URL, "cookie-test@example.com", "securepassword1")
	resp.Body.Close()

	loginResp := loginUser(t, client, env.server.URL, "cookie-test@example.com", "securepassword1")

	// Check the Set-Cookie header from the login response.
	var foundSession bool
	for _, cookie := range loginResp.Cookies() {
		if cookie.Name == "groovelab_session" {
			foundSession = true
			assert.True(t, cookie.HttpOnly, "session cookie must be HttpOnly")
			// SameSite Lax = 2 in Go's http package.
			assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite,
				"session cookie must have SameSite=Lax")
			break
		}
	}
	loginResp.Body.Close()
	assert.True(t, foundSession, "login response must set a session cookie")
}

// TestRedisSessionTTL verifies that the session in Redis has the expected TTL.
func TestRedisSessionTTL(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Register and login.
	resp := registerUser(t, client, env.server.URL, "ttl-test@example.com", "securepassword1")
	resp.Body.Close()
	loginResp := loginUser(t, client, env.server.URL, "ttl-test@example.com", "securepassword1")
	loginResp.Body.Close()

	// Find session token.
	cookies := client.Jar.Cookies(mustParseURL(t, env.server.URL))
	var sessionToken string
	for _, c := range cookies {
		if c.Name == "groovelab_session" {
			sessionToken = c.Value
			break
		}
	}
	require.NotEmpty(t, sessionToken, "session cookie must be set")

	// Check TTL in Redis.
	ttl, err := env.rdClient.TTL(context.Background(), "session:"+sessionToken).Result()
	require.NoError(t, err)
	// TTL should be close to 24 hours (within a few seconds of creation).
	assert.True(t, ttl > 23*time.Hour && ttl <= 24*time.Hour,
		"session TTL should be approximately 24 hours, got %v", ttl)
}

// registerUserWithName sends a POST /api/v1/auth/register request including a name field.
func registerUserWithName(t *testing.T, client *http.Client, baseURL, email, password, name string) *http.Response {
	t.Helper()
	return postJSON(t, client, baseURL+"/api/v1/auth/register", map[string]string{
		"email":    email,
		"password": password,
		"name":     name,
	})
}

// TestRegistration_WithName_PersistsName verifies that a name supplied at
// registration is stored and returned by /auth/me. GRO-0ar3 AC #4.
func TestRegistration_WithName_PersistsName(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Register with name.
	resp := registerUserWithName(t, client, env.server.URL, "named@example.com", "securepassword1", "Test User")
	defer resp.Body.Close()
	assert.True(t, resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusTemporaryRedirect,
		"expected 200, 302, or 307 for registration, got %d", resp.StatusCode)

	// Verify via /me.
	meResp, err := client.Get(env.server.URL + "/api/v1/auth/me")
	require.NoError(t, err)
	me := readBody(t, meResp)
	assert.Equal(t, http.StatusOK, meResp.StatusCode)
	assert.Equal(t, "named@example.com", me["email"])
	assert.Equal(t, "Test User", me["name"], "/auth/me should return the stored name")
	assert.Equal(t, true, me["isAdmin"], "first registered user should be admin")
}

// TestRegistration_WithoutName_ReturnsNullName verifies that omitting the name
// field during registration still succeeds and /auth/me returns name: null.
// GRO-0ar3 AC #5.
func TestRegistration_WithoutName_ReturnsNullName(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Register without name (standard helper omits name field).
	resp := registerUser(t, client, env.server.URL, "noname@example.com", "securepassword1")
	defer resp.Body.Close()
	assert.True(t, resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusTemporaryRedirect,
		"expected 200, 302, or 307 for registration, got %d", resp.StatusCode)

	// Verify via /me.
	meResp, err := client.Get(env.server.URL + "/api/v1/auth/me")
	require.NoError(t, err)
	me := readBody(t, meResp)
	assert.Equal(t, http.StatusOK, meResp.StatusCode)
	assert.Equal(t, "noname@example.com", me["email"])
	assert.Nil(t, me["name"], "/auth/me should return null name when not provided")
	// In an isolated test env this is the first (admin) user; assert isAdmin is
	// populated (not null) rather than its specific value.
	assert.NotNil(t, me["isAdmin"], "/auth/me should return a populated isAdmin field, not null")
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	u, err := url.Parse(rawURL)
	require.NoError(t, err)
	return u
}
