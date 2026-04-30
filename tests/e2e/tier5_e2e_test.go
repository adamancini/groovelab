package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier5E2E invokes the Tier 5 shell-based e2e test that verifies KOTS
// Config screen integration on a real Embedded Cluster install. The test
// covers two distinct guarantees:
//
//  1. Changes-take-effect: changing a Config item via `kots set config`
//     updates env vars on the running backend pod (SESSION_DURATION,
//     MAX_CARDS_PER_SESSION, GUEST_ACCESS_ENABLED). Includes a regex-
//     validation negative case.
//
//  2. Generated-defaults-survive-upgrade: the random external_db_password
//     generated on first install (`{{repl RandomString 24}}`) is the same
//     value after `kots upstream upgrade`. KOTS persists generated defaults
//     across re-renders -- this test enforces that contract.
//
// Optional Step 10 (external-DB toggle) is gated on TIER5_TEST_EXTERNAL_DB
// because it is destructive on the EC install (drops the embedded CNPG
// cluster) and requires a reachable external Postgres instance.
//
// This test requires a real bare Linux VM (EC_VM_HOST=user@host) and a
// Replicated license. When env vars are missing, the shell script exits 0
// with a SKIP message so that `go test` passes locally without a VM.
//
// Prerequisites:
//   - Docker (with buildx) running and authenticated to ghcr.io
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - EC_VM_HOST set to user@host of a bare Linux VM
//   - REPLICATED_LICENSE_ID and REPLICATED_CUSTOMER_ID env vars set
//   - helm v4, ssh, scp, yq installed
//
// Optional:
//   - TIER5_TEST_EXTERNAL_DB=1 plus TIER5_EXT_DB_HOST/PORT/USER/PASSWORD to
//     exercise Step 10 (external DB toggle).
//
// Run with: go test ./tests/e2e/ -run TestTier5E2E -v -timeout 90m
//
// See also: tests/e2e/tier5-runbook.md for the manual procedure.
func TestTier5E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier5_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("tier5 e2e test failed: %v", err)
	}
}
