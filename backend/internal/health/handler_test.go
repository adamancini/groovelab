package health_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/adamancini/groovelab/internal/health"
	"github.com/adamancini/groovelab/internal/migrate"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// testEnv holds shared test infrastructure.
type testEnv struct {
	pgPool      *pgxpool.Pool
	pgContainer *tcpostgres.PostgresContainer
	rdClient    *redis.Client
	rdContainer *tcredis.RedisContainer
	pgDSN       string
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	// Start PostgreSQL container.
	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("groovelab_test"),
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

	rdClient := redis.NewClient(&redis.Options{
		Addr: rdEndpoint,
	})
	t.Cleanup(func() { _ = rdClient.Close() })

	// Verify Redis connectivity.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	require.NoError(t, rdClient.Ping(pingCtx).Err(), "ping redis")

	return &testEnv{
		pgPool:      pgPool,
		pgContainer: pgContainer,
		rdClient:    rdClient,
		rdContainer: rdContainer,
		pgDSN:       pgDSN,
	}
}

func TestHealthz_AllHealthy(t *testing.T) {
	env := setupTestEnv(t)
	handler := health.NewHandler(env.pgPool, env.rdClient, "test-version")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	handler.Readiness(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "expected 200 when all deps healthy")

	var resp health.Response
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "ok", resp.Status)
	assert.Equal(t, "test-version", resp.Version)
	assert.Equal(t, "ok", resp.Checks["database"].Status)
	assert.Equal(t, "ok", resp.Checks["redis"].Status)
	assert.Equal(t, "ok", resp.Checks["license"].Status)
	assert.GreaterOrEqual(t, resp.Checks["database"].LatencyMs, int64(0))
	assert.GreaterOrEqual(t, resp.Checks["redis"].LatencyMs, int64(0))
}

func TestHealthz_DatabaseUnavailable(t *testing.T) {
	env := setupTestEnv(t)

	// Terminate the postgres container to simulate unavailability.
	err := env.pgContainer.Terminate(context.Background())
	require.NoError(t, err, "terminate postgres container")

	handler := health.NewHandler(env.pgPool, env.rdClient, "test-version")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	handler.Readiness(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "expected 503 when database is down")

	var resp health.Response
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "error", resp.Status)
	assert.Equal(t, "error", resp.Checks["database"].Status)
	assert.NotEmpty(t, resp.Checks["database"].Error)
	// Redis should still be ok.
	assert.Equal(t, "ok", resp.Checks["redis"].Status)
}

func TestHealthz_RedisUnavailable(t *testing.T) {
	env := setupTestEnv(t)

	// Terminate the redis container to simulate unavailability.
	err := env.rdContainer.Terminate(context.Background())
	require.NoError(t, err, "terminate redis container")

	handler := health.NewHandler(env.pgPool, env.rdClient, "test-version")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	handler.Readiness(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "expected 503 when redis is down")

	var resp health.Response
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "error", resp.Status)
	assert.Equal(t, "error", resp.Checks["redis"].Status)
	assert.NotEmpty(t, resp.Checks["redis"].Error)
	// Database should still be ok.
	assert.Equal(t, "ok", resp.Checks["database"].Status)
}

func TestLiveness_AlwaysOK(t *testing.T) {
	// Liveness does not need real dependencies -- it always returns 200.
	handler := health.NewHandler(nil, nil, "test-version")

	req := httptest.NewRequest(http.MethodGet, "/livez", nil)
	rec := httptest.NewRecorder()

	handler.Liveness(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "liveness must always return 200")

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "ok", resp["status"])
}

func TestMigrate_CleanDatabase(t *testing.T) {
	ctx := context.Background()

	// Start a fresh PostgreSQL container.
	pgContainer, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("groovelab_migrate_test"),
		tcpostgres.WithUsername("test"),
		tcpostgres.WithPassword("test"),
		tcpostgres.BasicWaitStrategies(),
	)
	require.NoError(t, err, "start postgres container for migration test")
	t.Cleanup(func() {
		_ = pgContainer.Terminate(context.Background())
	})

	dsn, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "get postgres connection string for migration test")

	// Resolve path to migrations directory relative to this test file.
	_, testFile, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(testFile), "..", "..", "migrations")

	// Run goose migrations using the internal/migrate package.
	migrateErr := migrate.Run(ctx, dsn, migrationsDir)
	require.NoError(t, migrateErr, "goose migrations should succeed on clean database")

	// Verify the app_metadata table was created and seeded.
	pool, poolErr := pgxpool.New(ctx, dsn)
	require.NoError(t, poolErr, "create pool for verification")
	defer pool.Close()

	var schemaVersion string
	err = pool.QueryRow(ctx, "SELECT value FROM app_metadata WHERE key = 'schema_version'").Scan(&schemaVersion)
	require.NoError(t, err, "query app_metadata after migration")
	assert.Equal(t, "1", schemaVersion)

	// Verify goose version table exists.
	var gooseTableExists bool
	err = pool.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'goose_db_version')").
		Scan(&gooseTableExists)
	require.NoError(t, err, "check goose_db_version table")
	assert.True(t, gooseTableExists, "goose_db_version table should exist after migration")
}
