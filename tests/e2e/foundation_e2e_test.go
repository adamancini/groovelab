package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestFoundationE2E invokes the shell-based e2e test suite against a real CMX cluster.
// The shell script handles cluster provisioning, Helm install, and smoke verification.
// Run with: go test ./tests/e2e/ -v -timeout 30m
func TestFoundationE2E(t *testing.T) {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	script := filepath.Join(dir, "foundation_e2e_test.sh")

	if _, err := os.Stat(script); os.IsNotExist(err) {
		t.Fatalf("e2e script not found: %s", script)
	}

	cmd := exec.Command("bash", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = dir

	if err := cmd.Run(); err != nil {
		t.Fatalf("e2e test failed: %v", err)
	}
}
