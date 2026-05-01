package replicated_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/adamancini/groovelab/internal/replicated"
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// testRedis spins up a Redis testcontainer and returns a connected client.
func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	ctx := context.Background()

	container, err := tcredis.Run(ctx,
		"redis:7-alpine",
		tcredis.WithLogLevel(tcredis.LogLevelVerbose),
	)
	require.NoError(t, err, "start redis container")
	t.Cleanup(func() {
		_ = container.Terminate(context.Background())
	})

	endpoint, err := container.Endpoint(ctx, "")
	require.NoError(t, err, "get redis endpoint")

	client := redis.NewClient(&redis.Options{
		Addr: endpoint,
	})
	t.Cleanup(func() { _ = client.Close() })

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	require.NoError(t, client.Ping(pingCtx).Err(), "ping redis")

	return client
}

// fakeSDKServer creates an httptest server that mimics the Replicated SDK API.
// It returns the server and a struct to control responses dynamically.
func fakeSDKServer(t *testing.T) (*httptest.Server, *fakeSDKState) {
	t.Helper()

	state := &fakeSDKState{
		licenseInfo: `{
			"license_id": "lic-123",
			"license_type": "paid",
			"expires_at": "2027-01-01T00:00:00Z",
			"entitlements": [
				{"field": "track_export_enabled", "value": "true"}
			]
		}`,
		updateInfo: `{
			"versionLabel": "1.2.0",
			"isDeployable": true
		}`,
		trackExportField: `{"value": "true"}`,
	}

	mux := chi.NewRouter()

	mux.Get("/api/v1/license/info", func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		defer state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(state.licenseInfo))
	})

	mux.Get("/api/v1/app/updates", func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		defer state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(state.updateInfo))
	})

	mux.Get("/api/v1/license/fields/{fieldName}", func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		defer state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(state.trackExportField))
	})

	mux.Post("/api/v1/app/custom-metrics", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		state.mu.Lock()
		state.lastMetricsPayload = string(body)
		state.metricsCallCount++
		state.mu.Unlock()

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success": true}`))
	})

	mux.Post("/api/v1/troubleshoot/supportbundle", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"bundle-fake-001"}`))
	})

	mux.Get("/api/v1/troubleshoot/supportbundle/{bundleID}/download", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("Content-Disposition", `attachment; filename="support-bundle.tar.gz"`)
		w.WriteHeader(http.StatusOK)
		// Write minimal fake archive data.
		_, _ = w.Write([]byte("fake-archive-data"))
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	return srv, state
}

type fakeSDKState struct {
	mu                 sync.RWMutex
	licenseInfo        string
	updateInfo         string
	trackExportField   string
	lastMetricsPayload string
	metricsCallCount   int
}

func (s *fakeSDKState) setLicenseInfo(info string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.licenseInfo = info
}

func (s *fakeSDKState) setTrackExportField(value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trackExportField = value
}

func (s *fakeSDKState) getLastMetricsPayload() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastMetricsPayload
}

func (s *fakeSDKState) getMetricsCallCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.metricsCallCount
}

func TestLicensePollingUpdatesRedis(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, _ := fakeSDKServer(t)

	// The SDK client should poll once on Start and cache in Redis.
	client := replicated.NewSDKClientWithURL(sdkServer.URL, rdClient, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client.Start(ctx)
	defer client.Stop()

	// Give the initial poll a moment to complete.
	time.Sleep(500 * time.Millisecond)

	// Verify the license info is cached in Redis.
	data, err := rdClient.Get(ctx, replicated.KeyLicenseInfo).Result()
	require.NoError(t, err, "license info should be cached in Redis")
	assert.Contains(t, data, "lic-123", "cached license info should contain the license ID")
	assert.Contains(t, data, "paid", "cached license info should contain the license type")
}

func TestUpdatePollingCachesCorrectly(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, _ := fakeSDKServer(t)

	client := replicated.NewSDKClientWithURL(sdkServer.URL, rdClient, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client.Start(ctx)
	defer client.Stop()

	time.Sleep(500 * time.Millisecond)

	data, err := rdClient.Get(ctx, replicated.KeyUpdateAvailable).Result()
	require.NoError(t, err, "update info should be cached in Redis")
	assert.Contains(t, data, "1.2.0", "cached update info should contain the version label")
	assert.Contains(t, data, "isDeployable", "cached update info should contain deployable flag")
}

func TestMetricsPostingVerifiesPayload(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, state := fakeSDKServer(t)

	// Without a DB pool, metrics will be zero but the POST should still happen.
	client := replicated.NewSDKClientWithURL(sdkServer.URL, rdClient, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client.Start(ctx)
	defer client.Stop()

	time.Sleep(500 * time.Millisecond)

	payload := state.getLastMetricsPayload()
	require.NotEmpty(t, payload, "custom metrics should have been posted")

	var mp replicated.MetricsPayload
	err := json.Unmarshal([]byte(payload), &mp)
	require.NoError(t, err, "metrics payload should be valid JSON")

	// Verify the payload structure has the expected fields.
	assert.GreaterOrEqual(t, mp.Data.ActiveUsers24h, 0, "active_users_24h should be >= 0")
	assert.GreaterOrEqual(t, mp.Data.FlashcardAttempts24h, 0, "flashcard_attempts_24h should be >= 0")
	assert.GreaterOrEqual(t, mp.Data.TracksCreatedTotal, 0, "tracks_created_total should be >= 0")
	assert.GreaterOrEqual(t, mp.Data.MasteryCompletionPct, 0.0, "mastery_completion_pct should be >= 0")

	assert.GreaterOrEqual(t, state.getMetricsCallCount(), 1, "at least one metrics POST should have been made")
}

func TestEntitlementFieldCaching(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, _ := fakeSDKServer(t)

	client := replicated.NewSDKClientWithURL(sdkServer.URL, rdClient, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client.Start(ctx)
	defer client.Stop()

	time.Sleep(500 * time.Millisecond)

	data, err := rdClient.Get(ctx, replicated.KeyLicenseFieldPrefix+"track_export_enabled").Result()
	require.NoError(t, err, "entitlement field should be cached in Redis")
	assert.Contains(t, data, "true", "cached field should contain 'true'")
}

func TestExpiredLicenseMiddleware(t *testing.T) {
	rdClient := testRedis(t)
	ctx := context.Background()

	// Set an expired license in Redis.
	expiredLicense := `{"license_id":"lic-expired","license_type":"paid","expires_at":"2020-01-01T00:00:00Z"}`
	err := rdClient.Set(ctx, replicated.KeyLicenseInfo, expiredLicense, 5*time.Minute).Err()
	require.NoError(t, err)

	// Build a handler with the license enforcement middleware.
	r := chi.NewRouter()
	r.Use(replicated.RequireLicenseValid(rdClient))
	r.Get("/api/v1/tracks", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"tracks":[]}`))
	})
	// Exempt routes should still work.
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	r.Get("/api/replicated/license", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"license":"ok"}`))
	})

	// Authenticated route should return 403.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tracks", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, "expired license should return 403 for api routes")

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "license_expired", resp["error"])
	assert.Equal(t, "Your license has expired", resp["message"])

	// Health probe should still work.
	req = httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, "healthz should still return 200 with expired license")

	// Replicated proxy should still work.
	req = httptest.NewRequest(http.MethodGet, "/api/replicated/license", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, "replicated proxy should still return 200 with expired license")
}

func TestEntitlementMiddleware_Enabled(t *testing.T) {
	rdClient := testRedis(t)
	ctx := context.Background()

	// Set entitlement field to true.
	err := rdClient.Set(ctx, replicated.KeyLicenseFieldPrefix+"track_export_enabled", `{"value":"true"}`, 5*time.Minute).Err()
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Use(replicated.RequireEntitlement(rdClient, "track_export_enabled"))
	r.Get("/export", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"export":"data"}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/export", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, "enabled entitlement should allow access")
}

func TestEntitlementMiddleware_Disabled(t *testing.T) {
	rdClient := testRedis(t)
	ctx := context.Background()

	// Set entitlement field to false.
	err := rdClient.Set(ctx, replicated.KeyLicenseFieldPrefix+"track_export_enabled", `{"value":"false"}`, 5*time.Minute).Err()
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Use(replicated.RequireEntitlement(rdClient, "track_export_enabled"))
	r.Get("/export", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"export":"data"}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/export", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, "disabled entitlement should return 403")

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "entitlement_disabled", resp["error"])
}

func TestEntitlementMiddleware_CacheMiss(t *testing.T) {
	rdClient := testRedis(t)

	// Do NOT set anything in Redis -- simulates cache miss.
	r := chi.NewRouter()
	r.Use(replicated.RequireEntitlement(rdClient, "track_export_enabled"))
	r.Get("/export", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"export":"data"}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/export", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, "cache miss should conservatively deny access")
}

func TestProxyHandler_License(t *testing.T) {
	rdClient := testRedis(t)
	ctx := context.Background()

	// Set license info in Redis.
	licenseData := `{"license_id":"lic-test","license_type":"paid"}`
	err := rdClient.Set(ctx, replicated.KeyLicenseInfo, licenseData, 5*time.Minute).Err()
	require.NoError(t, err)

	handler := replicated.NewHandler(rdClient)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/license", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, licenseData, rec.Body.String())
}

func TestProxyHandler_License_CacheMiss(t *testing.T) {
	rdClient := testRedis(t)

	handler := replicated.NewHandler(rdClient)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/license", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// GRO-xyqx: cold cache (SDK has not yet polled) is the expected normal
	// startup state, not a service-unavailable error. Return 200 with a typed
	// pending envelope so callers (browsers, ingresses, retry policies) do not
	// treat it as a transport failure.
	assert.Equal(t, http.StatusOK, rec.Code, "cold cache should return 200 with pending envelope")
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "pending", resp["status"], "cold cache should signal pending status")
	assert.Equal(t, "sdk_cache_empty", resp["reason"], "cold cache should explain reason")
}

func TestProxyHandler_Updates(t *testing.T) {
	rdClient := testRedis(t)
	ctx := context.Background()

	updateData := `{"versionLabel":"2.0.0","isDeployable":true}`
	err := rdClient.Set(ctx, replicated.KeyUpdateAvailable, updateData, 15*time.Minute).Err()
	require.NoError(t, err)

	handler := replicated.NewHandler(rdClient)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/updates", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, updateData, rec.Body.String())
}

func TestProxyHandler_Updates_CacheMiss(t *testing.T) {
	rdClient := testRedis(t)

	handler := replicated.NewHandler(rdClient)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/updates", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// GRO-xyqx: cold cache (SDK has not yet polled) is the expected normal
	// startup state, not a service-unavailable error. Return 200 with a typed
	// pending envelope so callers (browsers, ingresses, retry policies) do not
	// treat it as a transport failure.
	assert.Equal(t, http.StatusOK, rec.Code, "cold cache should return 200 with pending envelope")
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "pending", resp["status"], "cold cache should signal pending status")
	assert.Equal(t, "sdk_cache_empty", resp["reason"], "cold cache should explain reason")
}

// TestProxyHandler_Updates_RedisError covers the genuine "backend infra
// unreachable" case: Redis returns a non-Nil error. This must NOT be
// conflated with the cold-cache case -- it should still surface as a 5xx so
// callers can distinguish "we have not polled yet" from "the cache layer is
// down".
func TestProxyHandler_Updates_RedisError(t *testing.T) {
	// Point at a Redis that does not exist -> connection refused.
	rdClient := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1", // reserved unassigned port
		DialTimeout: 100 * time.Millisecond,
		ReadTimeout: 100 * time.Millisecond,
	})
	t.Cleanup(func() { _ = rdClient.Close() })

	handler := replicated.NewHandler(rdClient)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/updates", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// 502 Bad Gateway = upstream cache layer is unreachable. Not 503 (which
	// would conflate with cold cache prior to this change) and not 200 (which
	// would silently mask a real outage).
	assert.Equal(t, http.StatusBadGateway, rec.Code, "redis error should return 502 Bad Gateway")
}

// TestProxyHandler_License_RedisError mirrors the updates-redis-error case
// for the license endpoint.
func TestProxyHandler_License_RedisError(t *testing.T) {
	rdClient := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1",
		DialTimeout: 100 * time.Millisecond,
		ReadTimeout: 100 * time.Millisecond,
	})
	t.Cleanup(func() { _ = rdClient.Close() })

	handler := replicated.NewHandler(rdClient)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/license", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadGateway, rec.Code, "redis error should return 502 Bad Gateway")
}

func TestSDKGracefulErrorHandling(t *testing.T) {
	rdClient := testRedis(t)

	// Stand up a server that returns 500 for all SDK endpoints.
	mux := chi.NewRouter()
	mux.Get("/api/v1/license/info", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal error"}`))
	})
	mux.Get("/api/v1/app/updates", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	mux.Get("/api/v1/license/fields/{fieldName}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	mux.Post("/api/v1/app/custom-metrics", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	// The SDK client should not crash when the SDK returns errors.
	client := replicated.NewSDKClientWithURL(srv.URL, rdClient, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// This should not panic or crash.
	client.Start(ctx)
	time.Sleep(500 * time.Millisecond)
	client.Stop()

	// Redis should be empty since all polls failed.
	_, err := rdClient.Get(ctx, replicated.KeyLicenseInfo).Result()
	assert.ErrorIs(t, err, redis.Nil, "license info should not be cached when SDK returns errors")
}

func TestGenerateSupportBundle_ReturnsID(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, state := fakeSDKServer(t)
	_ = state

	handler := replicated.NewHandlerWithSDKURL(rdClient, sdkServer.URL)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodPost, "/support-bundle", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "generate bundle should return 200")

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.NotEmpty(t, resp["id"], "response should contain bundle ID")
}

func TestDownloadSupportBundle_StreamsArchive(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, state := fakeSDKServer(t)
	_ = state

	handler := replicated.NewHandlerWithSDKURL(rdClient, sdkServer.URL)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/support-bundle/bundle-test-123/download", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "download should return 200")
	assert.Contains(t, rec.Header().Get("Content-Disposition"), "support-bundle")
	assert.True(t, rec.Body.Len() > 0, "response body should contain archive data")
}

func TestDownloadSupportBundle_MissingID(t *testing.T) {
	rdClient := testRedis(t)
	sdkServer, state := fakeSDKServer(t)
	_ = state

	handler := replicated.NewHandlerWithSDKURL(rdClient, sdkServer.URL)
	r := chi.NewRouter()
	handler.MountRoutes(r)

	req := httptest.NewRequest(http.MethodGet, "/support-bundle//download", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Chi will either return 405 (no matching route) or the handler will reject
	// with 400. Either way it should not return 200.
	assert.NotEqual(t, http.StatusOK, rec.Code, "missing bundle ID should not return 200")
}

func TestValidLicenseAllowsAccess(t *testing.T) {
	rdClient := testRedis(t)
	ctx := context.Background()

	// Set a valid (non-expired) license in Redis.
	validLicense := `{"license_id":"lic-valid","license_type":"paid","expires_at":"2027-01-01T00:00:00Z"}`
	err := rdClient.Set(ctx, replicated.KeyLicenseInfo, validLicense, 5*time.Minute).Err()
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Use(replicated.RequireLicenseValid(rdClient))
	r.Get("/api/v1/tracks", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"tracks":[]}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tracks", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, "valid license should allow access")
}
