package auth

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestParseSessionDuration covers the SESSION_DURATION env var parsing wired
// from KOTS Config item "session_duration" (regex ^\d+[hm]$). See GRO-7uiw.
func TestParseSessionDuration_ValidHours(t *testing.T) {
	t.Setenv("SESSION_DURATION", "24h")
	d := parseSessionDuration()
	assert.Equal(t, 24*time.Hour, d, "24h should parse to 24 hours")
}

func TestParseSessionDuration_ValidMinutes(t *testing.T) {
	t.Setenv("SESSION_DURATION", "120m")
	d := parseSessionDuration()
	assert.Equal(t, 120*time.Minute, d, "120m should parse to 120 minutes")
}

func TestParseSessionDuration_Empty(t *testing.T) {
	// Ensure SESSION_DURATION is unset for this test (no t.Setenv hook here
	// because we explicitly want the empty-env branch).
	_ = os.Unsetenv("SESSION_DURATION")
	d := parseSessionDuration()
	assert.Equal(t, 24*time.Hour, d, "empty SESSION_DURATION should default to 24h")
}

func TestParseSessionDuration_Invalid(t *testing.T) {
	t.Setenv("SESSION_DURATION", "not-a-duration")
	d := parseSessionDuration()
	assert.Equal(t, 24*time.Hour, d, "invalid SESSION_DURATION should default to 24h")
}

// TestDefaultSessionConfig_HonoursEnv verifies the env var threads into
// DefaultSessionConfig.TTL.
func TestDefaultSessionConfig_HonoursEnv(t *testing.T) {
	t.Setenv("SESSION_DURATION", "30m")
	cfg := DefaultSessionConfig()
	assert.Equal(t, 30*time.Minute, cfg.TTL)
}
