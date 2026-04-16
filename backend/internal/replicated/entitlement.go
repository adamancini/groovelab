package replicated

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// RequireEntitlement returns a Chi middleware that checks whether a license
// entitlement field is set to "true" in the Redis cache. If the field is
// absent or not "true", it returns 403 with an entitlement_disabled error.
//
// The middleware reads from the Redis key license:field:{fieldName}, which
// is populated by the SDK client's background polling.
func RequireEntitlement(redisClient *redis.Client, fieldName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			defer cancel()

			key := KeyLicenseFieldPrefix + fieldName
			data, err := redisClient.Get(ctx, key).Result()
			if err != nil {
				if err != redis.Nil {
					log.Printf("[replicated] warning: failed to read entitlement %s: %v", fieldName, err)
				}
				// Cache miss or error: deny access conservatively.
				writeEntitlementDenied(w, fieldName)
				return
			}

			// The SDK returns the field value as a JSON object with a "value" key,
			// e.g. {"value": "true"} or just the string "true".
			// Try to parse as JSON first, then fall back to raw string.
			enabled := parseFieldValue(data)
			if enabled != "true" {
				writeEntitlementDenied(w, fieldName)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireLicenseValid returns a Chi middleware that checks whether the cached
// license is valid and not expired. If the license is expired or absent, it
// returns 403 with a license_expired error.
//
// Exempted paths: /healthz, /livez, /api/v1/auth/*, /api/replicated/*
func RequireLicenseValid(redisClient *redis.Client) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path

			// Exempt health probes, auth routes, and replicated proxy routes.
			if path == "/healthz" || path == "/livez" {
				next.ServeHTTP(w, r)
				return
			}
			if len(path) >= 13 && path[:13] == "/api/v1/auth/" {
				next.ServeHTTP(w, r)
				return
			}
			if len(path) >= 16 && path[:16] == "/api/replicated/" {
				next.ServeHTTP(w, r)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			defer cancel()

			data, err := redisClient.Get(ctx, KeyLicenseInfo).Result()
			if err != nil {
				// If cache is empty, allow the request through --
				// the SDK has not polled yet and we should not block on startup.
				if err == redis.Nil {
					next.ServeHTTP(w, r)
					return
				}
				log.Printf("[replicated] warning: failed to read license info for enforcement: %v", err)
				next.ServeHTTP(w, r)
				return
			}

			if isLicenseExpired(data) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"license_expired","message":"Your license has expired"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// licenseInfo is a minimal representation of the SDK license response
// used for expiry checking.
type licenseInfo struct {
	LicenseType string `json:"license_type"`
	ExpiresAt   string `json:"expires_at"`
}

// isLicenseExpired checks whether the cached license data indicates an
// expired or invalid license.
func isLicenseExpired(data string) bool {
	var info licenseInfo
	if err := json.Unmarshal([]byte(data), &info); err != nil {
		// If we cannot parse the license, treat as not expired to be safe.
		return false
	}

	if info.ExpiresAt == "" {
		// No expiry set (e.g. community license) -- treat as valid.
		return false
	}

	expires, err := time.Parse(time.RFC3339, info.ExpiresAt)
	if err != nil {
		// If we cannot parse the date, treat as not expired.
		return false
	}

	return time.Now().After(expires)
}

// fieldResponse represents the JSON response from the SDK license fields endpoint.
type fieldResponse struct {
	Value interface{} `json:"value"`
}

// parseFieldValue extracts the value from the SDK license field response.
// The SDK may return {"value": "true"} or just "true".
func parseFieldValue(data string) string {
	var resp fieldResponse
	if err := json.Unmarshal([]byte(data), &resp); err == nil {
		if s, ok := resp.Value.(string); ok {
			return s
		}
		if b, ok := resp.Value.(bool); ok {
			if b {
				return "true"
			}
			return "false"
		}
	}

	// Fall back to raw string (trimming quotes if present).
	trimmed := data
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		trimmed = trimmed[1 : len(trimmed)-1]
	}
	return trimmed
}

// writeEntitlementDenied writes a 403 response for a disabled entitlement.
func writeEntitlementDenied(w http.ResponseWriter, fieldName string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	resp := map[string]string{
		"error":   "entitlement_disabled",
		"message": "The " + fieldName + " entitlement is not enabled for your license.",
	}
	_ = json.NewEncoder(w).Encode(resp)
}
