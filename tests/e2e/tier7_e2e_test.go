package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier7E2E invokes the Tier 7 shell-based e2e test suite that verifies
// all operational requirements for the Replicated Bootcamp rubric:
//
//  1. Cosign signatures are present and valid on all released images
//  2. Air-gap install succeeds with network policy enabled
//  3. All application features work in air-gap mode (flashcards, fretboard, track builder)
//  4. Zero outbound network traffic is confirmed (only intra-namespace + DNS)
//  5. Air-gap validation report is produced
//  6. Email/webhook notification channels are configured (verification steps documented)
//
// This test requires a Replicated license, a bare Linux VM (EC_VM_HOST), and
// optionally an air-gap bundle (EC_AIRGAP_BUNDLE). When required env vars are
// not set, the shell script exits 0 with a SKIP message so that `go test`
// passes in local environments.
//
// Prerequisites:
//   - Docker (with buildx) authenticated to ghcr.io
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - REPLICATED_LICENSE_ID and REPLICATED_CUSTOMER_ID set
//   - EC_VM_HOST set to user@host of a bare Linux VM
//   - helm v4, ssh, scp, cosign, jq installed
//   - EC_AIRGAP_BUNDLE set (optional; air-gap test is skipped if missing)
//
// Run with: go test ./tests/e2e/ -run TestTier7E2E -v -timeout 120m
func TestTier7E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier7_test.sh")

	cmd := exec.Command("bash", script)
	cmd.Dir = filepath.Join(dir, "..")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Run(); err != nil {
		t.Fatalf("Tier 7 e2e test failed: %v", err)
	}
}
