package settings_test

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
	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/adamancini/groovelab/internal/fretboard"
	"github.com/adamancini/groovelab/internal/migrate"
	"github.com/adamancini/groovelab/internal/settings"
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
	querier    *queries.Querier
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	// Start PostgreSQL container.
	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("groovelab_settings_test"),
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

	// Run migrations (resolves from test file location).
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

	fretboardHandler := fretboard.NewHandler(pgPool)
	settingsHandler := settings.NewHandler(pgPool, authSystem.AB)

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(authSystem.LoadClientStateMiddleware())
	r.Use(authSystem.RememberMiddleware())

	// Auth routes.
	authSystem.MountRoutes(r, "/api/v1/auth")

	// Fretboard routes (public).
	r.Route("/api/v1/fretboard", func(r chi.Router) {
		r.Get("/tunings", fretboardHandler.ListTunings)
	})

	// Settings routes (protected).
	r.Route("/api/v1/settings", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Get("/", settingsHandler.GetSettings)
		r.Put("/", settingsHandler.UpdateSettings)
	})

	server := httptest.NewServer(r)
	t.Cleanup(func() { server.Close() })

	return &testEnv{
		pgPool:     pgPool,
		rdClient:   rdClient,
		server:     server,
		authSystem: authSystem,
		querier:    queries.New(pgPool),
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

func postJSON(t *testing.T, client *http.Client, url string, body interface{}) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	require.NoError(t, err)
	resp, err := client.Post(url, "application/json", bytes.NewReader(data))
	require.NoError(t, err)
	return resp
}

func putJSON(t *testing.T, client *http.Client, rawURL string, body interface{}) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPut, rawURL, bytes.NewReader(data))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
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

func registerAndLogin(t *testing.T, client *http.Client, baseURL, email, password string) {
	t.Helper()
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
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	u, err := url.Parse(rawURL)
	require.NoError(t, err)
	return u
}

// --- Tuning Preset Tests ---

func TestListTunings_ReturnsAllSeeded(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings")
	require.NoError(t, err)

	body := readBodyRaw(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var presets []queries.TuningPreset
	require.NoError(t, json.Unmarshal(body, &presets))
	assert.Len(t, presets, 7, "should return all 7 seeded tuning presets")

	// Verify preset names include the expected set.
	names := make(map[string]bool)
	for _, p := range presets {
		names[p.Name] = true
	}
	assert.True(t, names["Standard 4"])
	assert.True(t, names["Drop D 4"])
	assert.True(t, names["Half-step Down 4"])
	assert.True(t, names["Standard 5"])
	assert.True(t, names["Drop A 5"])
	assert.True(t, names["Standard 6"])
	assert.True(t, names["Half-step Down 6"])
}

func TestListTunings_FilterByStringCount(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	// Filter for 4-string tunings.
	resp, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=4")
	require.NoError(t, err)
	body := readBodyRaw(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var presets []queries.TuningPreset
	require.NoError(t, json.Unmarshal(body, &presets))
	assert.Len(t, presets, 3, "should return 3 four-string tuning presets")
	for _, p := range presets {
		assert.Equal(t, 4, p.StringCount)
	}

	// Filter for 5-string tunings.
	resp2, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=5")
	require.NoError(t, err)
	body2 := readBodyRaw(t, resp2)

	var presets5 []queries.TuningPreset
	require.NoError(t, json.Unmarshal(body2, &presets5))
	assert.Len(t, presets5, 2, "should return 2 five-string tuning presets")

	// Filter for 6-string tunings.
	resp3, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=6")
	require.NoError(t, err)
	body3 := readBodyRaw(t, resp3)

	var presets6 []queries.TuningPreset
	require.NoError(t, json.Unmarshal(body3, &presets6))
	assert.Len(t, presets6, 2, "should return 2 six-string tuning presets")
}

func TestListTunings_FilterInvalidStringCount(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=abc")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestListTunings_FilterNoResults(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=99")
	require.NoError(t, err)
	body := readBodyRaw(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var presets []queries.TuningPreset
	require.NoError(t, json.Unmarshal(body, &presets))
	assert.Len(t, presets, 0, "should return empty array for non-existent string count")
}

func TestListTunings_VerifySeedData(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=4")
	require.NoError(t, err)
	body := readBodyRaw(t, resp)

	var presets []queries.TuningPreset
	require.NoError(t, json.Unmarshal(body, &presets))

	// Find Standard 4 and verify its pitches.
	var standard4 *queries.TuningPreset
	for i, p := range presets {
		if p.Name == "Standard 4" {
			standard4 = &presets[i]
			break
		}
	}
	require.NotNil(t, standard4, "Standard 4 preset must exist")
	assert.True(t, standard4.IsDefault, "Standard 4 should be the default 4-string tuning")

	var pitches []string
	require.NoError(t, json.Unmarshal(standard4.Pitches, &pitches))
	assert.Equal(t, []string{"E1", "A1", "D2", "G2"}, pitches)
}

// --- Settings Auth Tests ---

func TestGetSettings_RequiresAuth(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp, err := client.Get(env.server.URL + "/api/v1/settings/")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestPutSettings_RequiresAuth(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)

	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"preferences": map[string]string{"theme": "dark"},
	})
	defer resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

// --- Settings CRUD Tests ---

func TestGetSettings_ReturnsDefaults(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "defaults@example.com", "securepassword1")

	resp, err := client.Get(env.server.URL + "/api/v1/settings/")
	require.NoError(t, err)
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// New users should have empty JSONB objects.
	assert.NotNil(t, body["instrumentSettings"])
	assert.NotNil(t, body["preferences"])
}

func TestPutSettings_UpdatePreferences(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "prefs@example.com", "securepassword1")

	// Update preferences.
	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"preferences": map[string]string{"theme": "dark"},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Verify preferences were updated.
	prefs, ok := body["preferences"].(map[string]interface{})
	require.True(t, ok, "preferences should be a JSON object")
	assert.Equal(t, "dark", prefs["theme"])
}

func TestPutSettings_JSONBMergeBehavior(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "merge@example.com", "securepassword1")

	// Set initial preferences.
	resp1 := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"preferences": map[string]interface{}{
			"theme":    "dark",
			"language": "en",
		},
	})
	resp1.Body.Close()
	assert.Equal(t, http.StatusOK, resp1.StatusCode)

	// Update only theme -- language should be preserved (JSONB merge, not replace).
	resp2 := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"preferences": map[string]interface{}{
			"theme": "light",
		},
	})
	body2 := readBody(t, resp2)
	assert.Equal(t, http.StatusOK, resp2.StatusCode)

	prefs, ok := body2["preferences"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "light", prefs["theme"], "theme should be updated")
	assert.Equal(t, "en", prefs["language"], "language should be preserved by merge")
}

func TestPutSettings_InstrumentSettingsWithValidPreset(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "preset@example.com", "securepassword1")

	// Get a valid preset ID.
	tuningsResp, err := client.Get(env.server.URL + "/api/v1/fretboard/tunings?string_count=4")
	require.NoError(t, err)
	tuningsBody := readBodyRaw(t, tuningsResp)
	var presets []queries.TuningPreset
	require.NoError(t, json.Unmarshal(tuningsBody, &presets))
	require.NotEmpty(t, presets, "should have 4-string presets")

	var standard4ID string
	for _, p := range presets {
		if p.Name == "Standard 4" {
			standard4ID = p.ID
			break
		}
	}
	require.NotEmpty(t, standard4ID, "Standard 4 preset must exist")

	// Set instrument settings with valid preset.
	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"instrumentSettings": map[string]interface{}{
			"stringCount":    4,
			"tuningPresetId": standard4ID,
			"fretRange":      []int{0, 12},
		},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	is, ok := body["instrumentSettings"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, standard4ID, is["tuningPresetId"])
	assert.Equal(t, float64(4), is["stringCount"])
}

func TestPutSettings_InvalidPresetIDReturns400(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "badpreset@example.com", "securepassword1")

	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"instrumentSettings": map[string]interface{}{
			"tuningPresetId": "00000000-0000-0000-0000-000000000000",
		},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, body["error"], "tuningPresetId")
}

func TestPutSettings_ValidCustomTuning(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "custom@example.com", "securepassword1")

	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"instrumentSettings": map[string]interface{}{
			"stringCount":  4,
			"customTuning": []string{"D1", "A1", "D2", "G2"},
		},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	is, ok := body["instrumentSettings"].(map[string]interface{})
	require.True(t, ok)
	ct, ok := is["customTuning"].([]interface{})
	require.True(t, ok)
	assert.Len(t, ct, 4)
}

func TestPutSettings_InvalidCustomTuningPitch(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "badpitch@example.com", "securepassword1")

	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"instrumentSettings": map[string]interface{}{
			"stringCount":  4,
			"customTuning": []string{"X9", "A1", "D2", "G2"},
		},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, body["error"], "invalid pitch")
}

func TestPutSettings_CustomTuningWrongLength(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "wronglen@example.com", "securepassword1")

	// Provide 3 pitches for a 4-string configuration.
	resp := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"instrumentSettings": map[string]interface{}{
			"stringCount":  4,
			"customTuning": []string{"D1", "A1", "D2"},
		},
	})
	body := readBody(t, resp)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Contains(t, body["error"], "stringCount")
}

func TestPutSettings_MergesInstrumentAndPreferences(t *testing.T) {
	env := setupTestEnv(t)
	client := newClientWithCookies(t)
	registerAndLogin(t, client, env.server.URL, "both@example.com", "securepassword1")

	// Set instrument settings.
	resp1 := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"instrumentSettings": map[string]interface{}{
			"stringCount": 4,
			"fretRange":   []int{0, 12},
		},
	})
	resp1.Body.Close()

	// Set preferences without touching instrument settings.
	resp2 := putJSON(t, client, env.server.URL+"/api/v1/settings/", map[string]interface{}{
		"preferences": map[string]interface{}{
			"theme": "dark",
		},
	})
	resp2.Body.Close()

	// Verify both are preserved.
	getResp, err := client.Get(env.server.URL + "/api/v1/settings/")
	require.NoError(t, err)
	body := readBody(t, getResp)
	assert.Equal(t, http.StatusOK, getResp.StatusCode)

	is, ok := body["instrumentSettings"].(map[string]interface{})
	require.True(t, ok, "instrumentSettings should be a JSON object")
	assert.Equal(t, float64(4), is["stringCount"], "instrumentSettings should be preserved")

	prefs, ok := body["preferences"].(map[string]interface{})
	require.True(t, ok, "preferences should be a JSON object")
	assert.Equal(t, "dark", prefs["theme"], "preferences should be preserved")
}
