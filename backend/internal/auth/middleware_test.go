package auth

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// passthroughHandler records whether it was invoked.
func passthroughHandler(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	})
}

// TestGuestAccessEnabled_DefaultTrue verifies the helper returns true when
// the env var is unset (KOTS Config item "guest_access" defaults on).
func TestGuestAccessEnabled_DefaultTrue(t *testing.T) {
	_ = os.Unsetenv("GUEST_ACCESS_ENABLED")
	assert.True(t, guestAccessEnabled(), "default should be true when env unset")
}

func TestGuestAccessEnabled_TrueLiteral(t *testing.T) {
	t.Setenv("GUEST_ACCESS_ENABLED", "true")
	assert.True(t, guestAccessEnabled())
}

func TestGuestAccessEnabled_OneLiteral(t *testing.T) {
	t.Setenv("GUEST_ACCESS_ENABLED", "1")
	assert.True(t, guestAccessEnabled())
}

func TestGuestAccessEnabled_FalseLiteral(t *testing.T) {
	t.Setenv("GUEST_ACCESS_ENABLED", "false")
	assert.False(t, guestAccessEnabled())
}

func TestGuestAccessEnabled_ZeroLiteral(t *testing.T) {
	t.Setenv("GUEST_ACCESS_ENABLED", "0")
	assert.False(t, guestAccessEnabled())
}

// TestConditionalAuth_GuestEnabled_Passthrough verifies that when guest
// access is on, ConditionalAuth returns a passthrough that does NOT touch ab.
// We pass a nil *authboss.Authboss to prove the passthrough never dereferences
// it -- the equivalent test for guest_access=false would require a real
// Authboss instance with Redis/Postgres and is exercised by the e2e suite.
func TestConditionalAuth_GuestEnabled_Passthrough(t *testing.T) {
	t.Setenv("GUEST_ACCESS_ENABLED", "true")

	mw := ConditionalAuth(nil)
	require.NotNil(t, mw)

	called := false
	handler := mw(passthroughHandler(&called))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/flashcards/session", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.True(t, called, "handler should be called when guest access is enabled")
	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestConditionalAuth_DefaultPassthrough verifies that with no env var set
// (the default in plain-helm installs without KOTS), ConditionalAuth is a
// passthrough.
func TestConditionalAuth_DefaultPassthrough(t *testing.T) {
	_ = os.Unsetenv("GUEST_ACCESS_ENABLED")

	mw := ConditionalAuth(nil)
	require.NotNil(t, mw)

	called := false
	handler := mw(passthroughHandler(&called))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/flashcards/session", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, rec.Code)
}
