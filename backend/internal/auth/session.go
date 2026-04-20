// Package auth provides Authboss configuration, session management, and
// middleware for the Groovelab backend.
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/aarondl/authboss/v3"
)

// SessionConfig controls session behaviour.
type SessionConfig struct {
	CookieName string
	TTL        time.Duration
	Secure     bool // set true when behind TLS
}

// parseSessionDuration reads SESSION_DURATION env var (e.g., "24h", "120m").
// Falls back to 24h if unset or invalid.
func parseSessionDuration() time.Duration {
	raw := os.Getenv("SESSION_DURATION")
	if raw == "" {
		return 24 * time.Hour
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 24 * time.Hour
	}
	return d
}

// DefaultSessionConfig returns production-safe defaults.
func DefaultSessionConfig() SessionConfig {
	return SessionConfig{
		CookieName: "groovelab_session",
		TTL:        parseSessionDuration(),
		Secure:     false,
	}
}

// CookieConfig controls cookie (remember-me) behaviour.
type CookieConfig struct {
	TTL    time.Duration
	Secure bool
}

// DefaultCookieConfig returns production-safe defaults.
func DefaultCookieConfig() CookieConfig {
	return CookieConfig{
		TTL:    30 * 24 * time.Hour,
		Secure: false,
	}
}

// -------------------------------------------------------------------
// RedisSessionStorer implements authboss.ClientStateReadWriter backed
// by Redis. Session data is stored at key "session:<token>".
// -------------------------------------------------------------------

// RedisSessionStorer persists session state in Redis.
type RedisSessionStorer struct {
	client *redis.Client
	cfg    SessionConfig
}

// NewRedisSessionStorer creates a session store.
func NewRedisSessionStorer(client *redis.Client, cfg SessionConfig) *RedisSessionStorer {
	return &RedisSessionStorer{client: client, cfg: cfg}
}

// sessionState is an in-memory snapshot of a Redis session.
type sessionState struct {
	values map[string]string
}

// Get retrieves a value from the session snapshot.
func (s *sessionState) Get(key string) (string, bool) {
	v, ok := s.values[key]
	return v, ok
}

// ReadState loads the session from Redis using the cookie token.
func (r *RedisSessionStorer) ReadState(req *http.Request) (authboss.ClientState, error) {
	cookie, err := req.Cookie(r.cfg.CookieName)
	if err != nil {
		// No session cookie — return empty state (not an error).
		return &sessionState{values: make(map[string]string)}, nil
	}

	token := cookie.Value
	if token == "" {
		return &sessionState{values: make(map[string]string)}, nil
	}

	ctx := req.Context()
	redisKey := "session:" + token

	data, err := r.client.Get(ctx, redisKey).Bytes()
	if err == redis.Nil {
		return &sessionState{values: make(map[string]string)}, nil
	} else if err != nil {
		return nil, fmt.Errorf("redis get session: %w", err)
	}

	vals := make(map[string]string)
	if err := json.Unmarshal(data, &vals); err != nil {
		return &sessionState{values: make(map[string]string)}, nil
	}

	return &sessionState{values: vals}, nil
}

// WriteState applies session events and persists to Redis.
func (r *RedisSessionStorer) WriteState(w http.ResponseWriter, state authboss.ClientState, events []authboss.ClientStateEvent) error {
	// Build current values map from existing state.
	vals := make(map[string]string)
	if ss, ok := state.(*sessionState); ok {
		for k, v := range ss.values {
			vals[k] = v
		}
	}

	// Determine the session token from the response writer context.
	// If the response writer wraps our token, use that; otherwise try
	// to extract it from the values or generate a new one.
	token := vals["_session_token"]

	hasDelAll := false
	for _, ev := range events {
		switch ev.Kind {
		case authboss.ClientStateEventPut:
			vals[ev.Key] = ev.Value
		case authboss.ClientStateEventDel:
			delete(vals, ev.Key)
		case authboss.ClientStateEventDelAll:
			hasDelAll = true
		}
	}

	ctx := context.Background()

	if hasDelAll {
		// Destroy session.
		if token != "" {
			_ = r.client.Del(ctx, "session:"+token).Err()
		}
		http.SetCookie(w, &http.Cookie{
			Name:     r.cfg.CookieName,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   r.cfg.Secure,
			SameSite: http.SameSiteLaxMode,
		})
		return nil
	}

	// If no token yet, generate one.
	if token == "" {
		t, err := generateToken(32)
		if err != nil {
			return fmt.Errorf("generate session token: %w", err)
		}
		token = t
		vals["_session_token"] = token
	}

	data, err := json.Marshal(vals)
	if err != nil {
		return fmt.Errorf("marshal session: %w", err)
	}

	if err := r.client.Set(ctx, "session:"+token, data, r.cfg.TTL).Err(); err != nil {
		return fmt.Errorf("redis set session: %w", err)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     r.cfg.CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(r.cfg.TTL.Seconds()),
		HttpOnly: true,
		Secure:   r.cfg.Secure,
		SameSite: http.SameSiteLaxMode,
	})

	return nil
}

// -------------------------------------------------------------------
// RedisCookieStorer implements authboss.ClientStateReadWriter for
// remember-me cookies backed by Redis. Key: "remember:<token>".
// -------------------------------------------------------------------

// RedisCookieStorer persists remember-me state in Redis.
type RedisCookieStorer struct {
	client *redis.Client
	cfg    CookieConfig
}

// NewRedisCookieStorer creates a cookie store.
func NewRedisCookieStorer(client *redis.Client, cfg CookieConfig) *RedisCookieStorer {
	return &RedisCookieStorer{client: client, cfg: cfg}
}

// cookieState is an in-memory snapshot of cookie values.
type cookieState struct {
	values map[string]string
}

// Get retrieves a cookie value from the snapshot.
func (c *cookieState) Get(key string) (string, bool) {
	v, ok := c.values[key]
	return v, ok
}

// ReadState reads all Authboss-relevant cookies from the request.
func (r *RedisCookieStorer) ReadState(req *http.Request) (authboss.ClientState, error) {
	vals := make(map[string]string)
	for _, c := range req.Cookies() {
		vals[c.Name] = c.Value
	}
	return &cookieState{values: vals}, nil
}

// WriteState applies cookie events by setting/deleting HTTP cookies.
// Remember-me tokens are also stored in Redis for server-side validation.
func (r *RedisCookieStorer) WriteState(w http.ResponseWriter, state authboss.ClientState, events []authboss.ClientStateEvent) error {
	for _, ev := range events {
		switch ev.Kind {
		case authboss.ClientStateEventPut:
			// Store the remember token in Redis.
			if ev.Key == authboss.CookieRemember {
				ctx := context.Background()
				redisKey := "remember:" + ev.Value
				_ = r.client.Set(ctx, redisKey, "1", r.cfg.TTL).Err()
			}
			http.SetCookie(w, &http.Cookie{
				Name:     ev.Key,
				Value:    ev.Value,
				Path:     "/",
				MaxAge:   int(r.cfg.TTL.Seconds()),
				HttpOnly: true,
				Secure:   r.cfg.Secure,
				SameSite: http.SameSiteLaxMode,
			})
		case authboss.ClientStateEventDel:
			if ev.Key == authboss.CookieRemember {
				// Try to clean up from Redis if we have the value.
				if cs, ok := state.(*cookieState); ok {
					if v, exists := cs.values[ev.Key]; exists {
						ctx := context.Background()
						_ = r.client.Del(ctx, "remember:"+v).Err()
					}
				}
			}
			http.SetCookie(w, &http.Cookie{
				Name:   ev.Key,
				Value:  "",
				Path:   "/",
				MaxAge: -1,
			})
		case authboss.ClientStateEventDelAll:
			// Delete all known cookies.
			if cs, ok := state.(*cookieState); ok {
				for k := range cs.values {
					http.SetCookie(w, &http.Cookie{
						Name:   k,
						Value:  "",
						Path:   "/",
						MaxAge: -1,
					})
				}
			}
		}
	}
	return nil
}

// generateToken produces a cryptographically random URL-safe token.
func generateToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
