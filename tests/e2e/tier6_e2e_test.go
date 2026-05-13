package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTier6E2E invokes the Tier 6 shell-based e2e test suite that verifies
// the Enterprise Portal is fully functional:
//
//  1. Portal branding assets are accessible (icon, logo)
//  2. Documentation is present and well-formed (helm-install, ec-install, upgrade)
//  3. Helm install from OCI registry succeeds on a fresh cluster
//  4. In-place Helm upgrade succeeds
//  5. Application is accessible after install and upgrade
//  6. Self-serve sign-up documentation is complete
//  7. CVE posture documentation is complete
//
// This test requires a Replicated license and a Kubernetes cluster (or CMX).
// When REPLICATED_API_TOKEN or REPLICATED_LICENSE_ID is not set, the shell
// script exits 0 with a SKIP message so that `go test` passes in local
// environments.
//
// Prerequisites:
//   - replicated CLI with REPLICATED_API_TOKEN set
//   - REPLICATED_LICENSE_ID set (for registry auth and install)
//   - kubectl configured (or KUBECONFIG set for CMX cluster)
//   - helm v4 installed
//
// Run with: go test ./tests/e2e/ -run TestTier6E2E -v -timeout 90m
func TestTier6E2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "tier6_test.sh")

	cmd := exec.Command("bash", script)
	cmd.Dir = filepath.Join(dir, "..")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Run(); err != nil {
		t.Fatalf("Tier 6 e2e test failed: %v", err)
	}
}
