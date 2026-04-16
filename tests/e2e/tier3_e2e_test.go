package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier3E2E invokes the Tier 3 shell-based e2e test suite that verifies
// preflight checks and support bundle collection on a real CMX cluster:
//
//  1. Run preflights on a compliant k3s 1.32 cluster -- all 5 checks pass
//  2. Verify the K8s version >= 1.28.0 check logic in the preflight spec
//  3. Generate a support bundle via the admin UI API
//  4. Verify bundle contains frontend, backend, PostgreSQL, Redis, and SDK logs
//  5. Verify health analyzer reports "ok" status
//  6. Verify deployment status analyzers report available replicas
//  7. Verify bundle can be downloaded locally as a valid tar.gz archive
//
// This test requires a Replicated license and customer for SDK-backed support
// bundle generation. When REPLICATED_API_TOKEN is not set, the shell script
// exits 0 with a SKIP message so that `go test` passes in local environments.
//
// Prerequisites:
//   - Docker (with buildx) running and authenticated to ghcr.io
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - REPLICATED_LICENSE_ID and REPLICATED_CUSTOMER_ID env vars set
//   - helm v4 installed
//   - kubectl installed
//   - kubectl preflight plugin (Troubleshoot CLI) installed
//
// Run with: go test ./tests/e2e/ -run TestTier3E2E -v -timeout 45m
func TestTier3E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier3_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("tier3 e2e test failed: %v", err)
	}
}
