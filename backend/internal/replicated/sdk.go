// Package replicated provides an SDK client that polls the Replicated SDK
// sidecar for license information, update availability, entitlement fields,
// and posts custom metrics. Results are cached in Redis so that downstream
// handlers and middleware can read them without direct SDK calls.
package replicated

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Redis key constants used by the SDK client and consumed by handlers/middleware.
const (
	KeyLicenseInfo        = "license:info"
	KeyUpdateAvailable    = "update:available"
	KeyLicenseFieldPrefix = "license:field:"
	TTLLicenseInfo        = 5 * time.Minute
	TTLUpdateAvailable    = 15 * time.Minute
	TTLLicenseField       = 5 * time.Minute
)

// SDKClient polls the Replicated SDK sidecar and caches results in Redis.
type SDKClient struct {
	baseURL    string
	httpClient *http.Client
	redis      *redis.Client
	dbPool     *pgxpool.Pool

	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewSDKClient creates a new SDK client. The baseURL defaults to
// REPLICATED_SDK_URL or http://groovelab-sdk:3000.
func NewSDKClient(redisClient *redis.Client, dbPool *pgxpool.Pool) *SDKClient {
	baseURL := os.Getenv("REPLICATED_SDK_URL")
	if baseURL == "" {
		baseURL = "http://groovelab-sdk:3000"
	}

	return &SDKClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		redis:  redisClient,
		dbPool: dbPool,
	}
}

// NewSDKClientWithURL creates a new SDK client with an explicit base URL.
// Primarily used in tests to point at httptest servers.
func NewSDKClientWithURL(baseURL string, redisClient *redis.Client, dbPool *pgxpool.Pool) *SDKClient {
	return &SDKClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		redis:  redisClient,
		dbPool: dbPool,
	}
}

// Start launches background goroutines for license polling, update polling,
// metrics posting, and entitlement field caching. Call Stop to shut down.
func (c *SDKClient) Start(ctx context.Context) {
	ctx, c.cancel = context.WithCancel(ctx)

	// Do an initial poll immediately for each.
	c.pollLicenseInfo(ctx)
	c.pollUpdates(ctx)
	c.pollEntitlementField(ctx, "track_export_enabled")
	c.postCustomMetrics(ctx)

	c.wg.Add(4)

	// License info: every 60 seconds.
	go func() {
		defer c.wg.Done()
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.pollLicenseInfo(ctx)
			}
		}
	}()

	// Update availability: every 15 minutes.
	go func() {
		defer c.wg.Done()
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.pollUpdates(ctx)
			}
		}
	}()

	// Custom metrics: every 5 minutes.
	go func() {
		defer c.wg.Done()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.postCustomMetrics(ctx)
			}
		}
	}()

	// Entitlement field track_export_enabled: every 60 seconds (same as license).
	go func() {
		defer c.wg.Done()
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.pollEntitlementField(ctx, "track_export_enabled")
			}
		}
	}()
}

// Stop cancels all background goroutines and waits for them to finish.
func (c *SDKClient) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	c.wg.Wait()
}

// pollLicenseInfo fetches license info from the SDK and caches it in Redis.
func (c *SDKClient) pollLicenseInfo(ctx context.Context) {
	body, err := c.doGet(ctx, "/api/v1/license/info")
	if err != nil {
		log.Printf("[replicated] warning: failed to poll license info: %v", err)
		return
	}

	if err := c.redis.Set(ctx, KeyLicenseInfo, string(body), TTLLicenseInfo).Err(); err != nil {
		log.Printf("[replicated] warning: failed to cache license info: %v", err)
	}
}

// pollUpdates fetches update availability from the SDK and caches it in Redis.
func (c *SDKClient) pollUpdates(ctx context.Context) {
	body, err := c.doGet(ctx, "/api/v1/app/updates")
	if err != nil {
		log.Printf("[replicated] warning: failed to poll updates: %v", err)
		return
	}

	if err := c.redis.Set(ctx, KeyUpdateAvailable, string(body), TTLUpdateAvailable).Err(); err != nil {
		log.Printf("[replicated] warning: failed to cache update info: %v", err)
	}
}

// pollEntitlementField fetches a single license field and caches it in Redis.
func (c *SDKClient) pollEntitlementField(ctx context.Context, fieldName string) {
	body, err := c.doGet(ctx, "/api/v1/license/fields/"+fieldName)
	if err != nil {
		log.Printf("[replicated] warning: failed to poll entitlement field %s: %v", fieldName, err)
		return
	}

	key := KeyLicenseFieldPrefix + fieldName
	if err := c.redis.Set(ctx, key, string(body), TTLLicenseField).Err(); err != nil {
		log.Printf("[replicated] warning: failed to cache entitlement field %s: %v", fieldName, err)
	}
}

// MetricsPayload is the JSON body sent to the custom metrics endpoint.
type MetricsPayload struct {
	Data MetricsData `json:"data"`
}

// MetricsData holds the custom metric values.
type MetricsData struct {
	ActiveUsers24h       int     `json:"active_users_24h"`
	FlashcardAttempts24h int     `json:"flashcard_attempts_24h"`
	TracksCreatedTotal   int     `json:"tracks_created_total"`
	MasteryCompletionPct float64 `json:"mastery_completion_pct"`
}

// postCustomMetrics gathers metrics from the database and posts them to the SDK.
func (c *SDKClient) postCustomMetrics(ctx context.Context) {
	metrics, err := c.gatherMetrics(ctx)
	if err != nil {
		log.Printf("[replicated] warning: failed to gather metrics: %v", err)
		return
	}

	payload := MetricsPayload{Data: metrics}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[replicated] warning: failed to marshal metrics: %v", err)
		return
	}

	if err := c.doPost(ctx, "/api/v1/app/custom-metrics", body); err != nil {
		log.Printf("[replicated] warning: failed to post custom metrics: %v", err)
	}
}

// gatherMetrics queries the database for current metric values.
func (c *SDKClient) gatherMetrics(ctx context.Context) (MetricsData, error) {
	var m MetricsData

	if c.dbPool == nil {
		return m, nil
	}

	// Active users in last 24 hours (users with sessions/activity).
	err := c.dbPool.QueryRow(ctx,
		"SELECT COUNT(DISTINCT user_id) FROM streaks WHERE practice_date >= CURRENT_DATE - INTERVAL '1 day'",
	).Scan(&m.ActiveUsers24h)
	if err != nil {
		log.Printf("[replicated] warning: active_users_24h query failed: %v", err)
		// Continue with zero value rather than failing entirely.
	}

	// Flashcard attempts in last 24 hours.
	err = c.dbPool.QueryRow(ctx,
		"SELECT COUNT(*) FROM flashcard_responses WHERE created_at >= NOW() - INTERVAL '24 hours'",
	).Scan(&m.FlashcardAttempts24h)
	if err != nil {
		log.Printf("[replicated] warning: flashcard_attempts_24h query failed: %v", err)
	}

	// Total tracks created.
	err = c.dbPool.QueryRow(ctx,
		"SELECT COUNT(*) FROM tracks",
	).Scan(&m.TracksCreatedTotal)
	if err != nil {
		log.Printf("[replicated] warning: tracks_created_total query failed: %v", err)
	}

	// Mastery completion percentage (average across all users who have progress).
	err = c.dbPool.QueryRow(ctx,
		`SELECT COALESCE(AVG(mastery_pct), 0) FROM (
			SELECT user_id,
				(COUNT(*) FILTER (WHERE mastery_level >= 3)::float / NULLIF(COUNT(*), 0)) * 100 AS mastery_pct
			FROM flashcard_progress
			GROUP BY user_id
		) sub`,
	).Scan(&m.MasteryCompletionPct)
	if err != nil {
		log.Printf("[replicated] warning: mastery_completion_pct query failed: %v", err)
	}

	return m, nil
}

// doGet performs a GET request against the SDK and returns the response body.
func (c *SDKClient) doGet(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// doPost performs a POST request against the SDK with the given JSON body.
func (c *SDKClient) doPost(ctx context.Context, path string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
