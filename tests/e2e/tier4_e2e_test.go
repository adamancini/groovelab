package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier4E2E invokes the Tier 4 shell-based e2e test suite that verifies
// EC install paths on a real bare Linux VM:
//
//  1. Prerequisites check (tools, env vars, VM reachability)
//  2. Build and push images to GHCR
//  3. Package Helm chart
//  4. Create e2e channel
//  5. Create KOTS release (yaml-dir + chart) and promote
//  6. Fresh EC install on VM: sudo ./groovelab install --license
//  7. Verify all pods Running, app accessible
//  8. Test LicenseFieldValue gate: track_export locked/unlocked
//  9. In-place upgrade: push new release, apply via admin console
//  10. Verify data persistence after upgrade
//  11. Air-gap install (skipped if EC_AIRGAP_BUNDLE not set)
//
// This test requires a real bare Linux VM (EC_VM_HOST=user@host) and a
// Replicated license. When EC_VM_HOST or REPLICATED_API_TOKEN is not set,
// the shell script exits 0 with a SKIP message so that `go test` passes
// in local environments.
//
// Prerequisites:
//   - Docker (with buildx) running and authenticated to ghcr.io
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - EC_VM_HOST set to user@host of a bare Linux VM
//   - REPLICATED_LICENSE_ID and REPLICATED_CUSTOMER_ID env vars set
//   - helm v4, ssh, scp installed
//
// Run with: go test ./tests/e2e/ -run TestTier4E2E -v -timeout 90m
func TestTier4E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier4_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("tier4 e2e test failed: %v", err)
	}
}
