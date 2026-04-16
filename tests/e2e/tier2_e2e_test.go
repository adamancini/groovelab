package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier2E2E invokes the Tier 2 shell-based e2e test suite that verifies
// SDK integration on a real CMX cluster: license enforcement, entitlement
// toggling (track export), custom metrics in Vendor Portal, update banner
// detection, branded SDK deployment, and proxy.xyyzx.net image verification.
//
// This test requires a Replicated license and customer. When REPLICATED_API_TOKEN,
// REPLICATED_LICENSE_ID, or REPLICATED_CUSTOMER_ID are not set, the shell script
// exits 0 with a SKIP message so that `go test` passes in local environments.
//
// Prerequisites:
//   - Docker (with buildx) running and authenticated to ghcr.io
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - REPLICATED_LICENSE_ID and REPLICATED_CUSTOMER_ID env vars set
//   - helm v4 installed
//   - kubectl installed
//
// Run with: go test ./tests/e2e/ -run TestTier2E2E -v -timeout 45m
func TestTier2E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier2_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("tier2 e2e test failed: %v", err)
	}
}
