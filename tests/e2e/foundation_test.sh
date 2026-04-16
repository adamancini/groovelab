#!/usr/bin/env bash
#
# E2e foundation pipeline test for Groovelab.
#
# Builds Docker images, pushes to GHCR, creates a Replicated release on a
# temporary channel, provisions a CMX k3s cluster, installs via Helm, and
# verifies the /healthz endpoint returns HTTP 200 with "status":"ok".
#
# Prerequisites:
#   - Docker (with buildx) running and authenticated to ghcr.io
#   - replicated CLI configured with a valid API token
#   - helm v4 installed
#   - kubectl installed
#
# Usage:
#   bash tests/e2e/foundation_test.sh
#
set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────
log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── configuration ────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_SLUG="groovelab"
TAG="e2e-$(date +%s)"
GHCR_PREFIX="ghcr.io/adamancini"
KUBECONFIG_FILE="/tmp/e2e-kubeconfig-${TAG}.yaml"
NAMESPACE="groovelab"

# ── state ────────────────────────────────────────────────────────────────────
CLUSTER_ID=""
CHANNEL_ID=""
PORT_FWD_PID=""

# ── cleanup (runs on EXIT) ───────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  log "=== CLEANUP ==="
  [ -n "$PORT_FWD_PID" ] && kill "$PORT_FWD_PID" 2>/dev/null || true
  [ -n "$CLUSTER_ID"   ] && { replicated cluster rm "$CLUSTER_ID" --app "$APP_SLUG" && log "Cluster removed."; } || true
  [ -n "$CHANNEL_ID"   ] && { replicated channel rm "$CHANNEL_ID" --app "$APP_SLUG" && log "Channel archived."; } || true
  rm -f "$KUBECONFIG_FILE"
  if [ $exit_code -eq 0 ]; then
    log "=== CLEANUP COMPLETE ==="
  else
    log "=== CLEANUP COMPLETE (test failed with exit code $exit_code) ==="
  fi
  exit "$exit_code"
}
trap cleanup EXIT

# ── STEP 1: GHCR credentials ─────────────────────────────────────────────────
log "=== STEP 1: Extract GHCR credentials ==="
GHCR_CREDS=$(echo "ghcr.io" | docker-credential-desktop get)
GHCR_USER=$(echo "$GHCR_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['Username'])")
GHCR_TOKEN=$(echo "$GHCR_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['Secret'])")
log "GHCR user: $GHCR_USER — credentials extracted."

# ── STEP 2: Build and push frontend ──────────────────────────────────────────
log "=== STEP 2: Build frontend image (tag: $TAG) ==="
docker buildx build --platform linux/amd64 \
  -t "${GHCR_PREFIX}/groovelab-frontend:${TAG}" \
  --push "${REPO_ROOT}/frontend/"
log "Step 2 complete — frontend pushed."

# ── STEP 3: Build and push backend ───────────────────────────────────────────
log "=== STEP 3: Build backend image (tag: $TAG) ==="
docker buildx build --platform linux/amd64 \
  -t "${GHCR_PREFIX}/groovelab-backend:${TAG}" \
  --push "${REPO_ROOT}/backend/"
log "Step 3 complete — backend pushed."

# ── STEP 4: Create temporary Replicated channel ───────────────────────────────
log "=== STEP 4: Create temp Replicated channel ==="
CHANNEL_OUTPUT=$(replicated channel create --name "e2e-${TAG}" --app "$APP_SLUG")
CHANNEL_ID=$(echo "$CHANNEL_OUTPUT" | awk 'NR==2 {print $1}')
log "Step 4 complete — channel: e2e-${TAG} (ID: $CHANNEL_ID)"

# ── STEP 5: Package and release ───────────────────────────────────────────────
log "=== STEP 5: Create Replicated release ==="
(cd "${REPO_ROOT}/chart" && helm dependency update .)
log "Dependencies updated."
replicated release create \
  --yaml-dir "${REPO_ROOT}/chart/" \
  --promote "e2e-${TAG}" \
  --version "$TAG" \
  --app "$APP_SLUG"
log "Step 5 complete — release $TAG promoted to e2e-${TAG}."

# ── STEP 6: Provision CMX cluster ─────────────────────────────────────────────
log "=== STEP 6: Provision CMX k3s cluster ==="
CLUSTER_OUTPUT=$(replicated cluster create \
  --distribution k3s \
  --version 1.32 \
  --name "e2e-${TAG}" \
  --wait 10m \
  --app "$APP_SLUG")
CLUSTER_ID=$(echo "$CLUSTER_OUTPUT" | awk 'NR==2 {print $1}')
log "Step 6 complete — cluster $CLUSTER_ID provisioned."

# ── STEP 7: Kubeconfig ────────────────────────────────────────────────────────
log "=== STEP 7: Export kubeconfig ==="
replicated cluster kubeconfig "$CLUSTER_ID" --app "$APP_SLUG" --output-path "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"
kubectl cluster-info
log "Step 7 complete."

# ── STEP 8: Install CNPG operator ─────────────────────────────────────────────
log "=== STEP 8: Install CNPG operator ==="
# Ensure subchart tarball is extracted (Helm v4 workaround)
if [ ! -d "${REPO_ROOT}/chart/charts/cloudnative-pg" ]; then
  mkdir -p "${REPO_ROOT}/chart/charts"
  (cd "${REPO_ROOT}/chart/charts" && for f in cloudnative-pg*.tgz; do [ -f "$f" ] && tar xzf "$f"; done)
fi
helm install cnpg-operator "${REPO_ROOT}/chart/charts/cloudnative-pg" \
  --namespace cnpg-system --create-namespace \
  --wait --timeout 3m
log "Step 8 complete — CNPG operator ready."

# ── STEP 9: Create namespace and imagePullSecret ──────────────────────────────
log "=== STEP 9: Create namespace and pull secret ==="
kubectl create namespace "$NAMESPACE"

# Create the CNPG credentials secret
kubectl apply -f - <<CNPGSECRET
apiVersion: v1
kind: Secret
metadata:
  name: groovelab-cnpg-credentials
  namespace: ${NAMESPACE}
type: kubernetes.io/basic-auth
stringData:
  username: groovelab
  password: e2e-test-password
CNPGSECRET

# Create the CNPG Cluster CR (operator is running, webhooks are ready)
kubectl apply -f - <<CNPGCLUSTER
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: groovelab-postgresql
  namespace: ${NAMESPACE}
spec:
  instances: 1
  bootstrap:
    initdb:
      database: groovelab
      owner: groovelab
      secret:
        name: groovelab-cnpg-credentials
  storage:
    size: 1Gi
CNPGCLUSTER

log "Waiting for CNPG Cluster to become ready..."
kubectl wait --for=condition=Ready cluster/groovelab-postgresql \
    -n "${NAMESPACE}" --timeout=5m || {
    log "CNPG Cluster status:"
    kubectl get cluster -n "${NAMESPACE}" -o yaml
    kubectl get pods -n "${NAMESPACE}" -l cnpg.io/cluster=groovelab-postgresql
    exit 1
}
log "CNPG Cluster is ready."

# The CNPG operator creates services with -rw/-r/-ro suffixes, but the backend
# deployment template references "groovelab-postgresql" (no suffix) as DB_HOST.
# Create an ExternalName alias so the init container can resolve the host.
kubectl apply -f - <<DBSVC
apiVersion: v1
kind: Service
metadata:
  name: groovelab-postgresql
  namespace: ${NAMESPACE}
spec:
  type: ExternalName
  externalName: groovelab-postgresql-rw.${NAMESPACE}.svc.cluster.local
  ports:
    - port: 5432
      targetPort: 5432
DBSVC
log "Database service alias created."

# Create GHCR pull secret
kubectl create secret docker-registry ghcr-credentials \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" \
  --docker-password="$GHCR_TOKEN" \
  --namespace "$NAMESPACE"
log "Step 9 complete."

# ── STEP 10: Helm install (no --wait) ─────────────────────────────────────────
log "=== STEP 10: helm install groovelab ==="
# Extract remaining subchart tarballs
(cd "${REPO_ROOT}/chart/charts" && for f in *.tgz; do [ -f "$f" ] && [ ! -d "${f%.tgz}" ] && tar xzf "$f" || true; done)
helm install groovelab "${REPO_ROOT}/chart/" \
  --namespace "$NAMESPACE" \
  --set image.frontend.repository="${GHCR_PREFIX}/groovelab-frontend" \
  --set image.frontend.tag="$TAG" \
  --set image.backend.repository="${GHCR_PREFIX}/groovelab-backend" \
  --set image.backend.tag="$TAG" \
  --set 'global.imagePullSecrets[0].name=ghcr-credentials' \
  --set global.replicated.dockerconfigjson=null \
  --set cert-manager.enabled=false \
  --set cloudnative-pg.enabled=false \
  --set replicated.enabled=false
log "Step 10 complete — helm install submitted."

# ── STEP 11: Poll pods ────────────────────────────────────────────────────────
log "=== STEP 11: Waiting for all pods Running (max 5m) ==="
DEADLINE=$(($(date +%s) + 300))
while true; do
  log "Pod status:"
  kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null || true
  NOT_READY=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null \
    | grep -v -E "Running|Completed" || true)
  [ -z "$NOT_READY" ] && break
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "TIMEOUT: the following pods are not Running:"
    echo "$NOT_READY"
    kubectl describe pods -n "$NAMESPACE" 2>/dev/null | tail -40
    exit 1
  fi
  sleep 15
done
log "Step 11 complete — all pods Running."

# ── STEP 12: Verify /healthz ─────────────────────────────────────────────────
log "=== STEP 12: Verify /healthz ==="
kubectl port-forward svc/groovelab-backend 18080:8080 -n "$NAMESPACE" &
PORT_FWD_PID=$!
sleep 4
RESPONSE=$(curl -sf http://localhost:18080/healthz)
log "healthz response: $RESPONSE"
echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok', f'status not ok: {d}'"
log "Step 12 complete — /healthz returned status: ok."

log "=== PASS: all steps completed successfully ==="
