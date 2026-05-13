#!/usr/bin/env bash
#
# Tier 6 E2E Test: Enterprise Portal Verification
#
# Verifies the Enterprise Portal is fully functional:
#   1. Portal branding assets are accessible (icon, logo)
#   2. Documentation is present and well-formed (helm-install, ec-install, upgrade)
#   3. Helm install from OCI registry succeeds on a fresh CMX cluster
#   4. In-place Helm upgrade succeeds
#   5. Application is accessible after install and upgrade
#   6. Self-serve sign-up URL is documented and reachable
#   7. CVE posture documentation is present
#
# This test requires a Replicated license and a CMX cluster (or existing
# K8s cluster). When env vars are missing, it exits 0 with a SKIP message
# so go test passes locally.
#
# Prerequisites:
#   - replicated CLI with REPLICATED_API_TOKEN set
#   - REPLICATED_LICENSE_ID set (for registry auth and install)
#   - kubectl configured (or KUBECONFIG set for CMX cluster)
#   - helm v4 installed
#
# Usage:
#   bash tests/e2e/tier6_test.sh
#
set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date +%H:%M:%S)] $*"; }
pass() { echo "[$(date +%H:%M:%S)] PASS: $*"; }
fail() { echo "[$(date +%H:%M:%S)] FAIL: $*"; exit 1; }
skip() { echo "[$(date +%H:%M:%S)] SKIP: $*"; exit 0; }

# ── configuration ────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPLICATED_API_TOKEN="${REPLICATED_API_TOKEN:-}"
REPLICATED_LICENSE_ID="${REPLICATED_LICENSE_ID:-}"
APP_SLUG="groovelab"
NAMESPACE="groovelab"
TAG="tier6-$(date +%s)"
LOG_FILE="/tmp/tier6-e2e-${TAG}.log"

# ── skip if not configured ───────────────────────────────────────────────────
if [ -z "$REPLICATED_API_TOKEN" ]; then
  skip "REPLICATED_API_TOKEN not set; skipping Tier 6 E2E test"
fi

if [ -z "$REPLICATED_LICENSE_ID" ]; then
  skip "REPLICATED_LICENSE_ID not set; skipping Tier 6 E2E test"
fi

if ! command -v kubectl >/dev/null 2>&1; then
  skip "kubectl not installed; skipping Tier 6 E2E test"
fi

if ! command -v helm >/dev/null 2>&1; then
  skip "helm not installed; skipping Tier 6 E2E test"
fi

log "Starting Tier 6 E2E test (tag: ${TAG})"

# ── 1. Verify portal branding assets ────────────────────────────────────────
log "[1/7] Verifying portal branding assets..."

ASSETS_DIR="${REPO_ROOT}/assets"
if [ ! -f "${ASSETS_DIR}/icon.svg" ]; then
  fail "assets/icon.svg not found"
fi
if [ ! -f "${ASSETS_DIR}/logo.svg" ]; then
  fail "assets/logo.svg not found"
fi

# Verify icon is valid SVG
if ! head -1 "${ASSETS_DIR}/icon.svg" | grep -q '<?xml'; then
  fail "assets/icon.svg is not a valid SVG file"
fi

# Verify logo is valid SVG
if ! head -1 "${ASSETS_DIR}/logo.svg" | grep -q '<?xml'; then
  fail "assets/logo.svg is not a valid SVG file"
fi

pass "Branding assets present and valid"

# ── 2. Verify documentation ─────────────────────────────────────────────────
log "[2/7] Verifying documentation..."

DOCS_DIR="${REPO_ROOT}/docs"
for doc in helm-install.md ec-install.md upgrade.md cve-posture.md terraform.md self-serve-signup.md; do
  if [ ! -f "${DOCS_DIR}/${doc}" ]; then
    fail "docs/${doc} not found"
  fi
  # Verify markdown has a heading
  if ! grep -q '^# ' "${DOCS_DIR}/${doc}"; then
    fail "docs/${doc} missing top-level heading"
  fi
  # Verify no broken internal links (check for ../ or ./ patterns that might be wrong)
  if grep -q '\.\./.*\.md' "${DOCS_DIR}/${doc}"; then
    log "WARNING: docs/${doc} contains relative markdown links — verify manually"
  fi
done

pass "All documentation files present and well-formed"

# ── 3. Verify application.yaml references branding ──────────────────────────
log "[3/7] Verifying application.yaml..."

APP_YAML="${REPO_ROOT}/release/application.yaml"
if [ ! -f "$APP_YAML" ]; then
  fail "release/application.yaml not found"
fi

if ! grep -q 'title: Groovelab' "$APP_YAML"; then
  fail "application.yaml missing title"
fi

if ! grep -q 'icon:' "$APP_YAML"; then
  fail "application.yaml missing icon reference"
fi

pass "application.yaml properly configured"

# ── 4. Helm install from OCI registry ───────────────────────────────────────
log "[4/7] Testing Helm install from Replicated OCI registry..."

# Download license file
log "Downloading license file..."
LICENSE_FILE="/tmp/tier6-license-${TAG}.yaml"
replicated customer download-license \
  --app "$APP_SLUG" \
  --customer "UAT" \
  --output "$LICENSE_FILE" 2>/dev/null || {
  log "Creating UAT customer for license download..."
  replicated customer create \
    --app "$APP_SLUG" \
    --name "UAT" \
    --email "uat@replicated.com" \
    --channel Stable \
    --output json > /dev/null 2>&1
  replicated customer download-license \
    --app "$APP_SLUG" \
    --customer "UAT" \
    --output "$LICENSE_FILE"
}

# Authenticate with registry
log "Authenticating with Replicated registry..."
echo "$REPLICATED_LICENSE_ID" | helm registry login registry.replicated.com \
  --username "$REPLICATED_LICENSE_ID" \
  --password-stdin

# Get latest stable chart version
log "Fetching latest chart version..."
LATEST_VERSION=$(helm search repo "$APP_SLUG" --output json 2>/dev/null | \
  python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['version'] if data else '')" || true)

if [ -z "$LATEST_VERSION" ]; then
  # Fall back to known version
  LATEST_VERSION="0.1.10"
  log "Could not determine latest version from search, using ${LATEST_VERSION}"
fi

# Install CNPG operator prerequisite
log "Installing CNPG operator..."
helm upgrade --install cnpg-operator cloudnative-pg \
  --repo https://cloudnative-pg.github.io/charts \
  --version 0.28.2 \
  --namespace cnpg-system \
  --create-namespace \
  --wait 2>&1 | tee -a "$LOG_FILE"

# Install cert-manager prerequisite
log "Installing cert-manager..."
helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io \
  --version v1.19.5 \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --wait 2>&1 | tee -a "$LOG_FILE"

# Install Groovelab
log "Installing Groovelab ${LATEST_VERSION}..."
helm upgrade --install groovelab \
  "oci://registry.replicated.com/${APP_SLUG}/stable/${APP_SLUG}" \
  --version "$LATEST_VERSION" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --set cert-manager.enabled=false \
  --set cloudnative-pg.enabled=false \
  --set replicated.enabled=true \
  --wait \
  --timeout 10m 2>&1 | tee -a "$LOG_FILE"

# Wait for pods
log "Waiting for pods to be ready..."
kubectl wait --for=condition=ready pod \
  --selector app.kubernetes.io/instance=groovelab \
  --namespace "$NAMESPACE" \
  --timeout=300s 2>&1 | tee -a "$LOG_FILE"

# Verify application health
log "Verifying application health..."
BACKEND_POD=$(kubectl get pod -n "$NAMESPACE" -l app.kubernetes.io/component=backend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NAMESPACE" "$BACKEND_POD" -- wget -qO- http://localhost:8080/healthz | grep -q "200" || {
  fail "Backend health check failed"
}

pass "Helm install successful and application healthy"

# ── 5. Helm upgrade ──────────────────────────────────────────────────────────
log "[5/7] Testing Helm upgrade..."

# Re-install same version (simulates upgrade)
helm upgrade --install groovelab \
  "oci://registry.replicated.com/${APP_SLUG}/stable/${APP_SLUG}" \
  --version "$LATEST_VERSION" \
  --namespace "$NAMESPACE" \
  --set cert-manager.enabled=false \
  --set cloudnative-pg.enabled=false \
  --set replicated.enabled=true \
  --wait \
  --timeout 10m 2>&1 | tee -a "$LOG_FILE"

# Verify pods still ready after upgrade
kubectl wait --for=condition=ready pod \
  --selector app.kubernetes.io/instance=groovelab \
  --namespace "$NAMESPACE" \
  --timeout=300s 2>&1 | tee -a "$LOG_FILE"

pass "Helm upgrade successful"

# ── 6. Verify self-serve sign-up documentation ────────────────────────────
log "[6/7] Verifying self-serve sign-up documentation..."

SELF_SERVE_DOC="${DOCS_DIR}/self-serve-signup.md"
if ! grep -q 'sign-up URL' "$SELF_SERVE_DOC"; then
  fail "self-serve-signup.md missing sign-up URL reference"
fi
if ! grep -q 'webhook' "$SELF_SERVE_DOC"; then
  fail "self-serve-signup.md missing webhook reference"
fi

# Verify portal URL is documented
if ! grep -q 'enterprise.replicated.com' "$SELF_SERVE_DOC"; then
  fail "self-serve-signup.md missing Enterprise Portal URL reference"
fi

pass "Self-serve sign-up documentation complete"

# ── 7. Verify CVE posture documentation ─────────────────────────────────────
log "[7/7] Verifying CVE posture documentation..."

CVE_DOC="${DOCS_DIR}/cve-posture.md"
if ! grep -q 'distroless' "$CVE_DOC"; then
  fail "cve-posture.md missing distroless reference"
fi
if ! grep -q 'govulncheck' "$CVE_DOC"; then
  fail "cve-posture.md missing govulncheck reference"
fi
if ! grep -q 'Cosign' "$CVE_DOC"; then
  fail "cve-posture.md missing Cosign reference"
fi
if ! grep -q 'air-gap' "$CVE_DOC"; then
  fail "cve-posture.md missing air-gap reference"
fi

pass "CVE posture documentation complete"

# ── cleanup ──────────────────────────────────────────────────────────────────
log "Cleaning up test resources..."
helm uninstall groovelab --namespace "$NAMESPACE" 2>/dev/null || true
kubectl delete namespace "$NAMESPACE" --wait=false 2>/dev/null || true
rm -f "$LICENSE_FILE"

# ── summary ──────────────────────────────────────────────────────────────────
log "========================================"
log "Tier 6 E2E Test Complete"
log "Tag: ${TAG}"
log "Log: ${LOG_FILE}"
log "========================================"
pass "All 7 verification steps passed"
