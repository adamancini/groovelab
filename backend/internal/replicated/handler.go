package replicated

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

// Handler serves proxy endpoints for the Replicated SDK cached data.
type Handler struct {
	redis      *redis.Client
	sdkBaseURL string
	httpClient *http.Client
}

// NewHandler creates a new Replicated proxy handler.
func NewHandler(redisClient *redis.Client) *Handler {
	sdkURL := os.Getenv("REPLICATED_SDK_URL")
	if sdkURL == "" {
		sdkURL = "http://groovelab-sdk:3000"
	}
	return &Handler{
		redis:      redisClient,
		sdkBaseURL: sdkURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// NewHandlerWithSDKURL creates a handler with an explicit SDK URL (for tests).
func NewHandlerWithSDKURL(redisClient *redis.Client, sdkURL string) *Handler {
	return &Handler{
		redis:      redisClient,
		sdkBaseURL: sdkURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// MountRoutes registers the /api/replicated/* routes on the given router.
func (h *Handler) MountRoutes(r chi.Router) {
	r.Get("/license", h.GetLicense)
	r.Get("/updates", h.GetUpdates)
	r.Post("/support-bundle", h.GenerateSupportBundle)
	r.Get("/support-bundle/{bundleID}/download", h.DownloadSupportBundle)
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

// GenerateSupportBundle proxies a support bundle generation request to the
// Replicated SDK. It POSTs to the SDK's troubleshoot endpoint and returns
// the bundle ID to the caller.
func (h *Handler) GenerateSupportBundle(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	sdkURL := h.sdkBaseURL + "/api/v1/troubleshoot/supportbundle"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sdkURL, nil)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"failed to create request: %s"}`, err.Error())))
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"failed to reach SDK: %s"}`, err.Error())))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"failed to read SDK response"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

// DownloadSupportBundle proxies a bundle download request to the SDK, streaming
// the archive back to the caller. The download is always available regardless
// of air-gap status.
func (h *Handler) DownloadSupportBundle(w http.ResponseWriter, r *http.Request) {
	bundleID := chi.URLParam(r, "bundleID")
	if bundleID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bundle ID is required"}`))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	sdkURL := fmt.Sprintf("%s/api/v1/troubleshoot/supportbundle/%s/download", h.sdkBaseURL, bundleID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sdkURL, nil)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"failed to create request: %s"}`, err.Error())))
		return
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"failed to reach SDK: %s"}`, err.Error())))
		return
	}
	defer resp.Body.Close()

	// Forward content headers from the SDK response.
	for _, header := range []string{"Content-Type", "Content-Disposition", "Content-Length"} {
		if v := resp.Header.Get(header); v != "" {
			w.Header().Set(header, v)
		}
	}

	// If the SDK did not set Content-Disposition, provide a default for download.
	if w.Header().Get("Content-Disposition") == "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="support-bundle-%s.tar.gz"`, bundleID))
	}

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
