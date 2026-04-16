package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier0E2E invokes the Tier 0 shell-based e2e test suite against a real CMX cluster.
// The shell script handles cluster provisioning, Helm install, and MVP user-journey
// verification: healthz, frontend pages, registration, admin panel, and pod resilience.
// Run with: go test ./tests/e2e/ -run TestTier0E2E -v -timeout 30m
func TestTier0E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier0_e2e_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("tier0 e2e test failed: %v", err)
	}
}
