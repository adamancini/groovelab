package replicated

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

// Handler serves proxy endpoints for the Replicated SDK cached data.
type Handler struct {
	redis *redis.Client
}

// NewHandler creates a new Replicated proxy handler.
func NewHandler(redisClient *redis.Client) *Handler {
	return &Handler{
		redis: redisClient,
	}
}

// MountRoutes registers the /api/replicated/* routes on the given router.
func (h *Handler) MountRoutes(r chi.Router) {
	r.Get("/license", h.GetLicense)
	r.Get("/updates", h.GetUpdates)
}

// GetLicense returns the cached license info from Redis.
// Returns 503 if the cache is empty (SDK has not yet polled).
func (h *Handler) GetLicense(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	data, err := h.redis.Get(ctx, KeyLicenseInfo).Result()
	if err == redis.Nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"license info not yet available"}`))
		return
	}
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"failed to read license info"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(data))
}

// GetUpdates returns the cached update availability from Redis.
// Returns 503 if the cache is empty (SDK has not yet polled).
func (h *Handler) GetUpdates(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	data, err := h.redis.Get(ctx, KeyUpdateAvailable).Result()
	if err == redis.Nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"update info not yet available"}`))
		return
	}
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"failed to read update info"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(data))
}
