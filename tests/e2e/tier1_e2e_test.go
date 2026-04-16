package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier1E2E invokes the Tier 1 shell-based e2e test suite that verifies the
// full CI/CD pipeline: PR workflow (build, sign, release, CMX test), release
// workflow (versioned images, Unstable channel), Stable promotion with email
// notification, RBAC enforcement, and Cosign signature verification.
//
// This test requires a GitHub remote with Actions enabled. When no remote is
// configured, the shell script exits 0 with a SKIP message so that `go test`
// passes in local-only environments.
//
// Prerequisites:
//   - gh CLI authenticated (gh auth status)
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - cosign installed
//   - GITHUB_OWNER and GITHUB_REPO env vars set
//
// Run with: go test ./tests/e2e/ -run TestTier1E2E -v -timeout 45m
func TestTier1E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier1_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("tier1 e2e test failed: %v", err)
	}
}
