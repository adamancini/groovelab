// Package health provides HTTP handlers for Kubernetes health probes.
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/adamancini/groovelab/internal/cache"
	"github.com/adamancini/groovelab/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// CheckResult represents the result of a single dependency health check.
type CheckResult struct {
	Status    string `json:"status"`
	LatencyMs int64  `json:"latency_ms"`
	// Optional fields for specific checks.
	Valid   *bool   `json:"valid,omitempty"`
	Expires *string `json:"expires,omitempty"`
	Error   string  `json:"error,omitempty"`
}

// Response is the top-level JSON response for the health endpoint.
type Response struct {
	Status  string                 `json:"status"`
	Version string                 `json:"version"`
	Checks  map[string]CheckResult `json:"checks"`
}

// Handler holds dependencies needed to perform health checks.
type Handler struct {
	DBPool      *pgxpool.Pool
	RedisClient *redis.Client
	Version     string
}

// NewHandler creates a new health check handler.
func NewHandler(dbPool *pgxpool.Pool, redisClient *redis.Client, version string) *Handler {
	return &Handler{
		DBPool:      dbPool,
		RedisClient: redisClient,
		Version:     version,
	}
}

// Readiness checks all dependencies and returns 200 only when database and
// redis are both healthy. License check is a stub that always returns ok.
func (h *Handler) Readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	checks := make(map[string]CheckResult)

	// Database check.
	dbLatency, dbErr := database.Ping(ctx, h.DBPool)
	dbCheck := CheckResult{
		Status:    "ok",
		LatencyMs: dbLatency.Milliseconds(),
	}
	if dbErr != nil {
		dbCheck.Status = "error"
		dbCheck.Error = dbErr.Error()
	}
	checks["database"] = dbCheck

	// Redis check.
	redisLatency, redisErr := cache.Ping(ctx, h.RedisClient)
	redisCheck := CheckResult{
		Status:    "ok",
		LatencyMs: redisLatency.Milliseconds(),
	}
	if redisErr != nil {
		redisCheck.Status = "error"
		redisCheck.Error = redisErr.Error()
	}
	checks["redis"] = redisCheck

	// License stub -- always ok until Tier 2.
	validTrue := true
	expiresStub := "2027-01-01T00:00:00Z"
	checks["license"] = CheckResult{
		Status:    "ok",
		LatencyMs: 0,
		Valid:     &validTrue,
		Expires:   &expiresStub,
	}

	// Overall status: ok only if both database and redis are ok.
	overallStatus := "ok"
	httpStatus := http.StatusOK
	if dbCheck.Status != "ok" || redisCheck.Status != "ok" {
		overallStatus = "error"
		httpStatus = http.StatusServiceUnavailable
	}

	resp := Response{
		Status:  overallStatus,
		Version: h.Version,
		Checks:  checks,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	_ = json.NewEncoder(w).Encode(resp)
}

// Liveness always returns HTTP 200. It confirms the process is running
// without checking external dependencies.
func (h *Handler) Liveness(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
	})
}
