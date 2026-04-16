#!/usr/bin/env bash
#
# Tier 0 E2e test for Groovelab.
#
# Extends the foundation pipeline with MVP user-journey verification:
#   1. Deploy to a CMX k3s cluster (same as foundation)
#   2. Verify /healthz with database and redis checks
#   3. Frontend reachable (HTTP 200 on /)
#   4. Guest can access /learn page (topic grid loads)
#   5. Guest can access /fretboard page (fretboard renders)
#   6. User can register an account (POST /api/v1/auth/register)
#   7. Admin can access /admin panel after login
#   8. All pods Running with no CrashLoopBackOff
#   9. Pod resilience: delete backend pod, wait for reschedule, /healthz ok
#
# Prerequisites:
#   - Docker (with buildx) running and authenticated to ghcr.io
#   - replicated CLI configured with a valid API token
#   - helm v4 installed
#   - kubectl installed
#
# Usage:
#   bash tests/e2e/tier0_e2e_test.sh
#
set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────
log() { echo "[$(date +%H:%M:%S)] $*"; }

# json_field extracts a top-level string field from JSON using python3.
# Usage: json_field '{"key":"val"}' key
json_field() {
  echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$2',''))"
}

# json_check validates a nested checks.<name>.status field equals "ok".
# Usage: json_check '{"checks":{"database":{"status":"ok"}}}' database
json_check() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['checks']['$2']['status']=='ok', f'$2 check failed: {d[\"checks\"][\"$2\"]}'"
}

# ── configuration ────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_SLUG="groovelab"
TAG="e2e-$(date +%s)"
GHCR_PREFIX="ghcr.io/adamancini"
KUBECONFIG_FILE="/tmp/e2e-kubeconfig-${TAG}.yaml"
NAMESPACE="groovelab"
LOG_FILE="/tmp/tier0-e2e-${TAG}.log"

# Port-forward local ports.
BACKEND_LOCAL_PORT=18080
FRONTEND_LOCAL_PORT=18443

# ── state ────────────────────────────────────────────────────────────────────
CLUSTER_ID=""
CHANNEL_ID=""
BACKEND_PF_PID=""
FRONTEND_PF_PID=""

# ── cleanup (runs on EXIT) ───────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  log "=== CLEANUP ==="
  [ -n "$BACKEND_PF_PID" ]  && kill "$BACKEND_PF_PID"  2>/dev/null || true
  [ -n "$FRONTEND_PF_PID" ] && kill "$FRONTEND_PF_PID" 2>/dev/null || true
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

# Tee all output to log file while keeping it on stdout/stderr.
exec > >(tee -a "$LOG_FILE") 2>&1
log "=== TIER 0 E2E TEST START ==="
log "Log file: $LOG_FILE"

# ════════════════════════════════════════════════════════════════════════════
# INFRASTRUCTURE SETUP (mirrors foundation_e2e_test.sh steps 1-11)
# ════════════════════════════════════════════════════════════════════════════

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
if [ ! -d "${REPO_ROOT}/chart/charts/cloudnative-pg" ]; then
  mkdir -p "${REPO_ROOT}/chart/charts"
  (cd "${REPO_ROOT}/chart/charts" && for f in cloudnative-pg*.tgz; do [ -f "$f" ] && tar xzf "$f"; done)
fi
helm install cnpg-operator "${REPO_ROOT}/chart/charts/cloudnative-pg" \
  --namespace cnpg-system --create-namespace \
  --wait --timeout 3m
log "Step 8 complete — CNPG operator ready."

# ── STEP 9: Create namespace, secrets, and CNPG Cluster ─────────────────────
log "=== STEP 9: Create namespace, secrets, and CNPG Cluster ==="
kubectl create namespace "$NAMESPACE"

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

kubectl create secret docker-registry ghcr-credentials \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" \
  --docker-password="$GHCR_TOKEN" \
  --namespace "$NAMESPACE"
log "Step 9 complete."

# ── STEP 10: Helm install (no --wait) ─────────────────────────────────────────
log "=== STEP 10: helm install groovelab ==="
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

# ════════════════════════════════════════════════════════════════════════════
# TIER 0 MVP VERIFICATION (new steps beyond foundation)
# ════════════════════════════════════════════════════════════════════════════

# ── STEP 12: Set up port-forwarding ──────────────────────────────────────────
log "=== STEP 12: Set up port-forwarding ==="
kubectl port-forward svc/groovelab-backend "${BACKEND_LOCAL_PORT}:8080" -n "$NAMESPACE" &
BACKEND_PF_PID=$!
kubectl port-forward svc/groovelab-frontend "${FRONTEND_LOCAL_PORT}:443" -n "$NAMESPACE" &
FRONTEND_PF_PID=$!
sleep 5
log "Step 12 complete — port-forwards active (backend=:${BACKEND_LOCAL_PORT}, frontend=:${FRONTEND_LOCAL_PORT})."

BACKEND_URL="http://localhost:${BACKEND_LOCAL_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_LOCAL_PORT}"

# ── STEP 13: Verify /healthz with dependency checks ─────────────────────────
log "=== STEP 13: Verify /healthz ==="
HEALTH_RESPONSE=$(curl -sf "${BACKEND_URL}/healthz")
log "healthz response: $HEALTH_RESPONSE"

# Verify top-level status.
HEALTH_STATUS=$(json_field "$HEALTH_RESPONSE" status)
if [ "$HEALTH_STATUS" != "ok" ]; then
  log "FAIL: /healthz status is '$HEALTH_STATUS', expected 'ok'"
  exit 1
fi

# Verify database and redis checks individually.
json_check "$HEALTH_RESPONSE" database
log "  database check: ok"
json_check "$HEALTH_RESPONSE" redis
log "  redis check: ok"
log "Step 13 complete — /healthz returned status: ok with all checks passing."

# ── STEP 14: Frontend reachable (HTTP 200 on /) ─────────────────────────────
log "=== STEP 14: Frontend reachable ==="
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${FRONTEND_URL}/")
if [ "$FRONTEND_STATUS" != "200" ]; then
  log "FAIL: frontend / returned HTTP $FRONTEND_STATUS, expected 200"
  exit 1
fi
log "Step 14 complete — frontend / returned HTTP 200."

# ── STEP 15: Guest can access /learn page (topic grid loads) ─────────────────
log "=== STEP 15: Guest can access /learn page ==="
# The SPA serves index.html for all frontend routes (/learn is a client-side route).
LEARN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${FRONTEND_URL}/learn")
if [ "$LEARN_STATUS" != "200" ]; then
  log "FAIL: frontend /learn returned HTTP $LEARN_STATUS, expected 200"
  exit 1
fi
log "  /learn page serves HTML: HTTP 200"

# Also verify the backend flashcard topics endpoint returns data (the topic grid source).
TOPICS_RESPONSE=$(curl -sf "${BACKEND_URL}/api/v1/flashcards/topics")
TOPICS_COUNT=$(echo "$TOPICS_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data) if isinstance(data, list) else 0)")
if [ "$TOPICS_COUNT" -lt 1 ]; then
  log "FAIL: /api/v1/flashcards/topics returned $TOPICS_COUNT topics, expected at least 1"
  log "Response: $TOPICS_RESPONSE"
  exit 1
fi
log "  flashcard topics endpoint returned $TOPICS_COUNT topics"
log "Step 15 complete — /learn page accessible with $TOPICS_COUNT topics."

# ── STEP 16: Guest can access /fretboard page (fretboard renders) ────────────
log "=== STEP 16: Guest can access /fretboard page ==="
FRETBOARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${FRONTEND_URL}/fretboard")
if [ "$FRETBOARD_STATUS" != "200" ]; then
  log "FAIL: frontend /fretboard returned HTTP $FRETBOARD_STATUS, expected 200"
  exit 1
fi
log "  /fretboard page serves HTML: HTTP 200"

# Verify the backend fretboard tunings endpoint returns data.
TUNINGS_RESPONSE=$(curl -sf "${BACKEND_URL}/api/v1/fretboard/tunings")
TUNINGS_COUNT=$(echo "$TUNINGS_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data) if isinstance(data, list) else 0)")
if [ "$TUNINGS_COUNT" -lt 1 ]; then
  log "FAIL: /api/v1/fretboard/tunings returned $TUNINGS_COUNT tunings, expected at least 1"
  log "Response: $TUNINGS_RESPONSE"
  exit 1
fi
log "  fretboard tunings endpoint returned $TUNINGS_COUNT tunings"
log "Step 16 complete — /fretboard page accessible with $TUNINGS_COUNT tunings."

# ── STEP 17: User can register an account ────────────────────────────────────
log "=== STEP 17: Register a new user account ==="
# Use a cookie jar to maintain session state across requests.
COOKIE_JAR="/tmp/e2e-cookies-${TAG}.txt"

# Register the first user (becomes admin per business logic).
REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "${BACKEND_URL}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@e2e-test.local","password":"SecureP@ss123!"}')

REGISTER_BODY=$(echo "$REGISTER_RESPONSE" | head -n -1)
REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -n 1)

# Authboss may return 200, 302, or 307 on successful registration.
if [[ "$REGISTER_STATUS" -ge 400 ]]; then
  log "FAIL: POST /api/v1/auth/register returned HTTP $REGISTER_STATUS"
  log "Response body: $REGISTER_BODY"
  exit 1
fi
log "  Registration returned HTTP $REGISTER_STATUS"
log "Step 17 complete — user registered successfully."

# ── STEP 18: Admin can access /admin panel after login ───────────────────────
log "=== STEP 18: Admin can access /admin panel ==="

# Log in as the registered user (who is admin, since first user).
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "${BACKEND_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@e2e-test.local","password":"SecureP@ss123!"}')

LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | head -n -1)
LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | tail -n 1)

if [[ "$LOGIN_STATUS" -ge 400 ]]; then
  log "FAIL: POST /api/v1/auth/login returned HTTP $LOGIN_STATUS"
  log "Response body: $LOGIN_BODY"
  exit 1
fi
log "  Login returned HTTP $LOGIN_STATUS"

# Access admin endpoint (requires auth + admin role).
ADMIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BACKEND_URL}/api/v1/admin/")

ADMIN_BODY=$(echo "$ADMIN_RESPONSE" | head -n -1)
ADMIN_STATUS=$(echo "$ADMIN_RESPONSE" | tail -n 1)

if [ "$ADMIN_STATUS" != "200" ]; then
  log "FAIL: GET /api/v1/admin/ returned HTTP $ADMIN_STATUS, expected 200"
  log "Response body: $ADMIN_BODY"
  exit 1
fi
log "  Admin panel returned HTTP 200"

# Verify admin users list endpoint.
ADMIN_USERS_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BACKEND_URL}/api/v1/admin/users")

ADMIN_USERS_BODY=$(echo "$ADMIN_USERS_RESPONSE" | head -n -1)
ADMIN_USERS_STATUS=$(echo "$ADMIN_USERS_RESPONSE" | tail -n 1)

if [ "$ADMIN_USERS_STATUS" != "200" ]; then
  log "FAIL: GET /api/v1/admin/users returned HTTP $ADMIN_USERS_STATUS, expected 200"
  log "Response body: $ADMIN_USERS_BODY"
  exit 1
fi

ADMIN_USERS_COUNT=$(echo "$ADMIN_USERS_BODY" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data) if isinstance(data, list) else 0)")
if [ "$ADMIN_USERS_COUNT" -lt 1 ]; then
  log "FAIL: admin users list returned $ADMIN_USERS_COUNT users, expected at least 1"
  exit 1
fi
log "  Admin users list returned $ADMIN_USERS_COUNT user(s)"
log "Step 18 complete — admin panel accessible with user list."

# ── STEP 19: Verify no CrashLoopBackOff ──────────────────────────────────────
log "=== STEP 19: Verify no CrashLoopBackOff ==="
CRASH_PODS=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null \
  | grep -i "CrashLoopBackOff" || true)
if [ -n "$CRASH_PODS" ]; then
  log "FAIL: pods in CrashLoopBackOff:"
  echo "$CRASH_PODS"
  exit 1
fi
log "Step 19 complete — no pods in CrashLoopBackOff."

# ── STEP 20: Pod resilience — delete backend pod, verify recovery ────────────
log "=== STEP 20: Pod resilience — delete backend pod ==="

# Capture the current backend pod name.
BACKEND_POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/component=backend \
  --no-headers -o custom-columns=":metadata.name" | head -1)
log "  Current backend pod: $BACKEND_POD"

# Delete the pod.
kubectl delete pod "$BACKEND_POD" -n "$NAMESPACE" --wait=false
log "  Deleted pod $BACKEND_POD, waiting for replacement..."

# Kill the old port-forward (it will break when the pod dies).
kill "$BACKEND_PF_PID" 2>/dev/null || true
BACKEND_PF_PID=""

# Wait for a new backend pod to be Running (max 3m).
DEADLINE=$(($(date +%s) + 180))
while true; do
  log "  Pod status:"
  kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null || true
  NEW_POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/component=backend \
    --no-headers 2>/dev/null | grep -E "Running" | grep -v "$BACKEND_POD" || true)
  # Also accept the same-named pod in Running state if it was recreated.
  [ -z "$NEW_POD" ] && NEW_POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/component=backend \
    --no-headers 2>/dev/null | grep -E "Running" || true)
  [ -n "$NEW_POD" ] && break
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "TIMEOUT: backend pod did not recover within 3 minutes"
    kubectl get pods -n "$NAMESPACE" 2>/dev/null
    kubectl describe pods -n "$NAMESPACE" -l app.kubernetes.io/component=backend 2>/dev/null | tail -30
    exit 1
  fi
  sleep 10
done
NEW_BACKEND_POD=$(echo "$NEW_POD" | awk '{print $1}' | head -1)
log "  New backend pod running: $NEW_BACKEND_POD"

# Re-establish port-forward.
kubectl port-forward svc/groovelab-backend "${BACKEND_LOCAL_PORT}:8080" -n "$NAMESPACE" &
BACKEND_PF_PID=$!
sleep 5

# Verify /healthz on the new pod.
RECOVERY_RESPONSE=$(curl -sf "${BACKEND_URL}/healthz")
RECOVERY_STATUS=$(json_field "$RECOVERY_RESPONSE" status)
if [ "$RECOVERY_STATUS" != "ok" ]; then
  log "FAIL: /healthz after pod recovery returned status '$RECOVERY_STATUS'"
  log "Response: $RECOVERY_RESPONSE"
  exit 1
fi
log "  /healthz after recovery: ok"
log "Step 20 complete — backend pod recovered, /healthz returns ok."

# ── cleanup cookie jar ───────────────────────────────────────────────────────
rm -f "$COOKIE_JAR"

# ════════════════════════════════════════════════════════════════════════════
log "=== PASS: all Tier 0 steps completed successfully ==="
log "Log file saved to: $LOG_FILE"
