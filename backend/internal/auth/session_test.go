package auth

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestParseSessionDuration_ValidHours(t *testing.T) {
	os.Setenv("SESSION_DURATION", "24h")
	defer os.Unsetenv("SESSION_DURATION")

	d := parseSessionDuration()
	assert.Equal(t, 24*time.Hour, d, "24h should parse to 24 hours")
}

func TestParseSessionDuration_ValidMinutes(t *testing.T) {
	os.Setenv("SESSION_DURATION", "120m")
	defer os.Unsetenv("SESSION_DURATION")

	d := parseSessionDuration()
	assert.Equal(t, 120*time.Minute, d, "120m should parse to 120 minutes")
}

func TestParseSessionDuration_Empty(t *testing.T) {
	os.Unsetenv("SESSION_DURATION")

	d := parseSessionDuration()
	assert.Equal(t, 24*time.Hour, d, "empty SESSION_DURATION should default to 24h")
}

func TestParseSessionDuration_Invalid(t *testing.T) {
	os.Setenv("SESSION_DURATION", "not-a-duration")
	defer os.Unsetenv("SESSION_DURATION")

	d := parseSessionDuration()
	assert.Equal(t, 24*time.Hour, d, "invalid SESSION_DURATION should default to 24h")
}
