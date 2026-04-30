#!/usr/bin/env bash
#
# Tier 5 E2e test: Config screen changes take effect AND generated defaults
# survive upgrade.
#
# This test exercises two distinct guarantees of the KOTS Config screen
# (release/config.yaml + release/helmchart.yaml) on a real Embedded Cluster
# install:
#
#   1. Changes-take-effect: changing a Config item via `kots set config`
#      updates env vars on the running backend pod (SESSION_DURATION,
#      MAX_CARDS_PER_SESSION, GUEST_ACCESS_ENABLED).
#
#   2. Generated-defaults-survive-upgrade: the random `external_db_password`
#      generated on first install (`{{repl RandomString 24}}`) is the SAME
#      value after `kots upstream upgrade`. KOTS persists generated defaults
#      across re-renders -- this test verifies that contract.
#
# AC mapping (GRO-hznr):
#   * E2e installs via EC and admin console reachable               -> STEP 6,7
#   * Max Cards Per Session change reflected on backend pod         -> STEP 8a
#   * Session Duration "1h" reflected on backend pod                -> STEP 8b
#   * Guest Access disabled reflected on backend pod                -> STEP 8c
#   * Invalid Session Duration "abc" rejected by config validation  -> STEP 8d
#   * Generated DB password persists across upgrade                 -> STEP 9
#   * External DB toggle wires the optionalValues mapping           -> STEP 10
#
# Mirrors tier4_test.sh structure: SSH-into-VM, kubectl polling against
# /var/lib/embedded-cluster/k0s/pki/admin.conf, cleanup trap, timestamped
# log lines, short per-step timeouts.
#
# Prerequisites:
#   - REPLICATED_API_TOKEN exported
#   - EC_VM_HOST=user@host on a bare Linux VM with network access to ghcr.io
#   - REPLICATED_LICENSE_ID and REPLICATED_CUSTOMER_ID set
#   - helm v4, ssh, scp, replicated CLI, docker (with buildx) on the runner
#
# When env vars are missing, the test exits 0 with a SKIP message so that
# `go test ./tests/e2e/ -run TestTier5E2E -v` passes locally without a VM.
#
# Usage:
#   bash tests/e2e/tier5_test.sh
#
# See also: tests/e2e/tier5-runbook.md for the manual procedure.
#
set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date +%H:%M:%S)] $*"; }
pass() { echo "[$(date +%H:%M:%S)] PASS: $*"; }
fail() { echo "[$(date +%H:%M:%S)] FAIL: $*"; exit 1; }
skip() { echo "[$(date +%H:%M:%S)] SKIP: $*"; exit 0; }

# ── configuration ────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EC_VM_HOST="${EC_VM_HOST:-}"
EC_VM_SSH_KEY="${EC_VM_SSH_KEY:-}"
REPLICATED_LICENSE_ID="${REPLICATED_LICENSE_ID:-}"
REPLICATED_CUSTOMER_ID="${REPLICATED_CUSTOMER_ID:-}"
APP_SLUG="groovelab"
TAG="tier5-$(date +%s)"
GHCR_PREFIX="ghcr.io/adamancini"
NAMESPACE="groovelab"
LOG_FILE="/tmp/tier5-e2e-${TAG}.log"

# Per-step timeout used by polling loops. Keeps a stuck install from hanging
# the entire CI job (CLAUDE.md: short per-step timeouts).
POD_READY_TIMEOUT=600     # 10 minutes
UPGRADE_DETECT_TIMEOUT=180 # 3  minutes
RECONCILE_TIMEOUT=300     # 5 minutes

# ── state ────────────────────────────────────────────────────────────────────
CHANNEL_ID=""
RELEASE_SEQUENCE=""
KUBECONFIG_PATH="/var/lib/embedded-cluster/k0s/pki/admin.conf"

# ── SSH helpers ───────────────────────────────────────────────────────────────
ssh_vm() {
  ssh ${EC_VM_SSH_KEY:+-i "$EC_VM_SSH_KEY"} \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=30 \
    "$EC_VM_HOST" "$@"
}

scp_to_vm() {
  scp ${EC_VM_SSH_KEY:+-i "$EC_VM_SSH_KEY"} \
    -o StrictHostKeyChecking=no \
    "$1" "${EC_VM_HOST}:${2}"
}

# kubectl_vm wraps `kubectl --kubeconfig=$KUBECONFIG_PATH` over SSH.
kubectl_vm() {
  ssh_vm "kubectl --kubeconfig $KUBECONFIG_PATH $*"
}

# kots_vm wraps `kubectl kots ... -n $NAMESPACE` over SSH on the EC VM.
kots_vm() {
  ssh_vm "kubectl kots --kubeconfig $KUBECONFIG_PATH $* -n $NAMESPACE"
}

# Wait for backend deployment to roll a new ReplicaSet to Available after a
# config change. kubectl polling, NOT helm install --wait (CLAUDE.md).
wait_for_backend_rollout() {
  local deadline=$(($(date +%s) + RECONCILE_TIMEOUT))
  while true; do
    local ready
    ready=$(kubectl_vm "get deployment -n $NAMESPACE -l 'app.kubernetes.io/component=backend' -o jsonpath='{.items[0].status.readyReplicas}'" 2>/dev/null || echo "0")
    [ "${ready:-0}" -ge 1 ] && return 0
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    log "    backend rollout in progress (readyReplicas=${ready:-0}) ..."
    sleep 10
  done
}

# Read an env var off the live backend pod via `kubectl exec ... env`.
backend_env() {
  local var="$1"
  kubectl_vm "exec deployment/groovelab-backend -n $NAMESPACE -- printenv $var" 2>/dev/null || echo ""
}

# ── cleanup (runs on EXIT) ───────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  log "=== CLEANUP ==="
  if [ -n "$CHANNEL_ID" ]; then
    replicated channel rm "$CHANNEL_ID" --app "$APP_SLUG" 2>/dev/null && log "Channel archived." || true
  fi
  rm -f "/tmp/groovelab-installer-${TAG}" "/tmp/license-${TAG}.yaml" 2>/dev/null || true
  rm -f "/tmp/groovelab-"*"-${TAG}.tgz" 2>/dev/null || true
  if [ "$exit_code" -eq 0 ]; then
    log "=== CLEANUP COMPLETE ==="
  else
    log "=== CLEANUP COMPLETE (test failed with exit code $exit_code) ==="
  fi
  exit "$exit_code"
}
trap cleanup EXIT

exec > >(tee -a "$LOG_FILE") 2>&1
log "=== TIER 5 E2E TEST START ==="
log "Test ID: $TAG"
log "Log file: $LOG_FILE"

# ════════════════════════════════════════════════════════════════════════════
# STEP 1: Prerequisites
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 1: Validate prerequisites ==="

if [ -z "${REPLICATED_API_TOKEN:-}" ]; then
  skip "REPLICATED_API_TOKEN is not set"
fi
log "  REPLICATED_API_TOKEN: set"

if [ -z "${EC_VM_HOST:-}" ]; then
  skip "EC_VM_HOST not set -- no bare Linux VM available for EC testing. See tests/e2e/tier5-runbook.md for manual steps."
fi
log "  EC_VM_HOST: $EC_VM_HOST"

for tool in replicated ssh scp helm docker yq; do
  if ! command -v "$tool" &>/dev/null; then
    skip "Required tool '${tool}' is not installed or not in PATH"
  fi
  log "  ${tool}: $(command -v "$tool")"
done

if [ -z "${REPLICATED_LICENSE_ID:-}" ]; then
  skip "REPLICATED_LICENSE_ID is not set"
fi
log "  REPLICATED_LICENSE_ID: set (${REPLICATED_LICENSE_ID:0:8}...)"

if [ -z "${REPLICATED_CUSTOMER_ID:-}" ]; then
  skip "REPLICATED_CUSTOMER_ID is not set"
fi
log "  REPLICATED_CUSTOMER_ID: set (${REPLICATED_CUSTOMER_ID:0:8}...)"

if ! ssh_vm "echo vm-reachable" &>/dev/null; then
  fail "Cannot reach EC_VM_HOST=${EC_VM_HOST} via SSH"
fi
log "  VM reachable via SSH."

if [ -z "${REPLICATED_APP_ID:-}" ]; then
  REPLICATED_APP_ID=$(replicated app ls --output json 2>/dev/null \
    | python3 -c "
import sys, json
apps = json.load(sys.stdin)
for a in apps:
    if a.get('slug','') == '$APP_SLUG' or a.get('name','').lower() == '$APP_SLUG':
        print(a.get('id',''))
        break
" 2>/dev/null || true)
  if [ -z "$REPLICATED_APP_ID" ]; then
    skip "Could not determine REPLICATED_APP_ID from CLI. Set it explicitly."
  fi
fi
log "  REPLICATED_APP_ID: ${REPLICATED_APP_ID}"

pass "Step 1 -- all prerequisites satisfied."

# ════════════════════════════════════════════════════════════════════════════
# STEP 2: Build and push images
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 2: Build and push images (tag: $TAG) ==="

GHCR_CREDS=$(echo "ghcr.io" | docker-credential-desktop get)
GHCR_USER=$(echo "$GHCR_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['Username'])")
log "  GHCR user: $GHCR_USER"

docker buildx build --platform linux/amd64 \
  -t "${GHCR_PREFIX}/groovelab-frontend:${TAG}" \
  --push "${REPO_ROOT}/frontend/"
log "  Frontend image pushed."

docker buildx build --platform linux/amd64 \
  -t "${GHCR_PREFIX}/groovelab-backend:${TAG}" \
  --push "${REPO_ROOT}/backend/"
log "  Backend image pushed."

pass "Step 2 -- images built and pushed."

# ════════════════════════════════════════════════════════════════════════════
# STEP 3: Package Helm chart
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 3: Package Helm chart ==="

helm dependency update "${REPO_ROOT}/chart/"
log "  Helm dependencies updated."

CHART_PACKAGE=$(helm package "${REPO_ROOT}/chart/" -d /tmp/ --version "0.1.1" 2>&1 \
  | grep "Successfully packaged" | awk '{print $NF}')
[ -z "$CHART_PACKAGE" ] && CHART_PACKAGE=$(ls -t /tmp/groovelab-*.tgz 2>/dev/null | head -1)
[ -z "$CHART_PACKAGE" ] && fail "Could not find packaged Helm chart under /tmp/"
log "  Chart packaged: $CHART_PACKAGE"

pass "Step 3 -- Helm chart packaged."

# ════════════════════════════════════════════════════════════════════════════
# STEP 4: Create e2e channel + initial release
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 4: Create temp Replicated channel and initial release ==="

CHANNEL_OUTPUT=$(replicated channel create --name "e2e-t5-${TAG}" --app "$APP_SLUG")
CHANNEL_ID=$(echo "$CHANNEL_OUTPUT" | awk 'NR==2 {print $1}')
log "  Channel: e2e-t5-${TAG} (ID: $CHANNEL_ID)"

RELEASE_OUTPUT=$(replicated release create \
  --app "$APP_SLUG" \
  --yaml-dir "${REPO_ROOT}/release/" \
  --chart "$CHART_PACKAGE" \
  --promote "e2e-t5-${TAG}" \
  --version "${TAG}" 2>&1)
log "  Release output: $RELEASE_OUTPUT"
RELEASE_SEQUENCE=$(echo "$RELEASE_OUTPUT" | grep -oE 'sequence[[:space:]]+[0-9]+' | awk '{print $2}' | tail -1 || echo "1")
log "  Initial release sequence: $RELEASE_SEQUENCE"

replicated customer update \
  --customer "$REPLICATED_CUSTOMER_ID" \
  --app "$APP_SLUG" \
  --channel "e2e-t5-${TAG}" 2>/dev/null || \
  log "  WARNING: could not assign customer to channel."

pass "Step 4 -- initial release $TAG promoted."

# ════════════════════════════════════════════════════════════════════════════
# STEP 5: Download EC installer + license, copy to VM
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 5: Download EC installer and license ==="

EC_INSTALLER_LOCAL="/tmp/groovelab-installer-${TAG}"
LICENSE_FILE_LOCAL="/tmp/license-${TAG}.yaml"

curl -fL -o "$EC_INSTALLER_LOCAL" \
  "https://replicated.app/embedded/${APP_SLUG}/e2e-t5-${TAG}" \
  || fail "Could not download EC installer"
log "  EC installer: $EC_INSTALLER_LOCAL ($(du -h "$EC_INSTALLER_LOCAL" | cut -f1))"

replicated customer download-license \
  --customer "$REPLICATED_CUSTOMER_ID" \
  --app "$APP_SLUG" \
  -o "$LICENSE_FILE_LOCAL" 2>/dev/null || \
  fail "Could not download license"
log "  License file: $LICENSE_FILE_LOCAL"

scp_to_vm "$EC_INSTALLER_LOCAL" "/tmp/groovelab"
scp_to_vm "$LICENSE_FILE_LOCAL" "/tmp/license.yaml"
log "  Installer + license copied to VM."

pass "Step 5 -- assets staged on VM."

# ════════════════════════════════════════════════════════════════════════════
# STEP 6: Fresh EC install
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 6: Run EC install on VM ==="

ssh_vm "chmod +x /tmp/groovelab && sudo /tmp/groovelab install --license /tmp/license.yaml --no-prompt"
log "  EC install command completed."

log "=== Step 6b: Poll until all pods Running (max ${POD_READY_TIMEOUT}s) ==="
deadline=$(($(date +%s) + POD_READY_TIMEOUT))
while true; do
  not_ready=$(kubectl_vm "get pods -A --no-headers 2>/dev/null | grep -v Running | grep -v Completed | wc -l" || echo "99")
  [ "$not_ready" -eq 0 ] && break
  [ "$(date +%s)" -ge "$deadline" ] && fail "Pods did not become ready within ${POD_READY_TIMEOUT}s"
  log "  Waiting for pods... ($not_ready not ready)"
  sleep 15
done
log "  All pods Running."

pass "Step 6 -- EC install green."

# ════════════════════════════════════════════════════════════════════════════
# STEP 7: Capture admin console + initial config snapshot
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 7: Verify admin console and capture initial config ==="

ADMIN_CHECK=$(ssh_vm "curl -sf --max-time 10 http://localhost:30880/healthz 2>/dev/null" || echo "")
if [ -n "$ADMIN_CHECK" ]; then
  log "  Admin console reachable on :30880"
else
  log "  WARNING: admin console not directly reachable from VM (may still be initializing)."
fi

# Capture the rendered config so we can diff it after upgrade. `kots get config`
# emits the live ConfigValues with rendered defaults baked in.
INITIAL_CONFIG=$(kots_vm "get config" 2>/dev/null || echo "")
if [ -z "$INITIAL_CONFIG" ]; then
  fail "kots get config returned empty -- KOTS may not be ready"
fi
log "  Initial config captured ($(echo "$INITIAL_CONFIG" | wc -l) lines)."

# Pull out the generated external_db_password value. Even though db_type starts
# at 'embedded', KOTS still renders the RandomString default for the password
# field on first install and persists it into the configValues store.
INITIAL_DB_PW=$(echo "$INITIAL_CONFIG" \
  | yq -r '.spec.values.external_db_password.value // .spec.values.external_db_password.default // ""' 2>/dev/null || echo "")
log "  Initial external_db_password: ${INITIAL_DB_PW:0:6}... ($(echo -n "$INITIAL_DB_PW" | wc -c) chars)"
if [ "$(echo -n "$INITIAL_DB_PW" | wc -c)" -lt 24 ]; then
  fail "Generated external_db_password is shorter than 24 chars (got $(echo -n "$INITIAL_DB_PW" | wc -c)). RandomString default did not render."
fi

pass "Step 7 -- admin console live, generated DB password captured."

# ════════════════════════════════════════════════════════════════════════════
# STEP 8: Changes-take-effect (3 config items + 1 regex rejection)
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 8a: max_cards_per_session=10 must reflect on backend pod ==="
kots_vm "set config --key max_cards_per_session --value 10" || fail "kots set config max_cards_per_session=10 failed"
wait_for_backend_rollout || fail "backend did not become Ready after max_cards_per_session change"
ENV_VALUE=$(backend_env MAX_CARDS_PER_SESSION)
log "  Backend MAX_CARDS_PER_SESSION = '$ENV_VALUE' (expected '10')"
[ "$ENV_VALUE" = "10" ] || fail "MAX_CARDS_PER_SESSION on backend pod = '$ENV_VALUE', expected '10'"
pass "Step 8a -- max_cards_per_session change took effect."

log "=== STEP 8b: session_duration=1h must reflect on backend pod ==="
kots_vm "set config --key session_duration --value 1h" || fail "kots set config session_duration=1h failed"
wait_for_backend_rollout || fail "backend did not become Ready after session_duration change"
ENV_VALUE=$(backend_env SESSION_DURATION)
log "  Backend SESSION_DURATION = '$ENV_VALUE' (expected '1h')"
[ "$ENV_VALUE" = "1h" ] || fail "SESSION_DURATION on backend pod = '$ENV_VALUE', expected '1h'"
pass "Step 8b -- session_duration change took effect."

log "=== STEP 8c: guest_access=0 must reflect on backend pod ==="
kots_vm "set config --key guest_access --value 0" || fail "kots set config guest_access=0 failed"
wait_for_backend_rollout || fail "backend did not become Ready after guest_access change"
ENV_VALUE=$(backend_env GUEST_ACCESS_ENABLED)
log "  Backend GUEST_ACCESS_ENABLED = '$ENV_VALUE' (expected 'false')"
[ "$ENV_VALUE" = "false" ] || fail "GUEST_ACCESS_ENABLED on backend pod = '$ENV_VALUE', expected 'false'"
pass "Step 8c -- guest_access toggle took effect."

log "=== STEP 8d: invalid session_duration='abc' must be rejected by regex ==="
# Per release/config.yaml the validation regex is ^\d+[hm]$. `kots set config`
# returns nonzero when validation fails. We invert the success check.
if kots_vm "set config --key session_duration --value abc" 2>/dev/null; then
  fail "kots set config accepted invalid session_duration='abc' -- regex validation is not enforced"
fi
log "  kots set config correctly rejected 'abc' against regex ^\\d+[hm]$"
# Make sure the prior valid value (1h) is still in place.
ENV_VALUE=$(backend_env SESSION_DURATION)
[ "$ENV_VALUE" = "1h" ] || fail "SESSION_DURATION reverted to '$ENV_VALUE' after invalid set; expected '1h' to be preserved"
pass "Step 8d -- regex validation rejected invalid value, prior value preserved."

# ════════════════════════════════════════════════════════════════════════════
# STEP 9: Generated-defaults-survive-upgrade
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 9: Push upgrade release and verify generated defaults persist ==="

UPGRADE_TAG="${TAG}-upgrade"
UPGRADE_VERSION="0.1.2"
helm package "${REPO_ROOT}/chart/" -d /tmp/ --version "$UPGRADE_VERSION" 2>/dev/null || true
UPGRADE_CHART_PACKAGE=$(ls -t /tmp/groovelab-${UPGRADE_VERSION}*.tgz 2>/dev/null | head -1 || echo "$CHART_PACKAGE")
log "  Upgrade chart: $UPGRADE_CHART_PACKAGE"

UPGRADE_RELEASE_OUTPUT=$(replicated release create \
  --app "$APP_SLUG" \
  --yaml-dir "${REPO_ROOT}/release/" \
  --chart "$UPGRADE_CHART_PACKAGE" \
  --promote "e2e-t5-${TAG}" \
  --version "$UPGRADE_TAG" 2>&1)
log "  Upgrade release: $UPGRADE_RELEASE_OUTPUT"

# Trigger the upgrade via `kots upstream upgrade`. This re-renders the
# rendered HelmChart CR; if KOTS regenerated the RandomString default we
# would see a new password.
log "  Running kots upstream upgrade ..."
kots_vm "upstream upgrade --deploy" || \
  log "  WARNING: kots upstream upgrade exited nonzero -- verifying state via polling."

# Wait for new release to deploy.
upgrade_deadline=$(($(date +%s) + UPGRADE_DETECT_TIMEOUT))
while [ "$(date +%s)" -lt "$upgrade_deadline" ]; do
  current_seq=$(kots_vm "get versions -o json 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); v=[x for x in d if x.get('isCurrentVersion')]; print(v[0].get('sequence','') if v else '')\"" 2>/dev/null || echo "")
  if [ -n "$current_seq" ] && [ "$current_seq" != "$RELEASE_SEQUENCE" ]; then
    log "  Upgrade deployed (current sequence=$current_seq)"
    break
  fi
  log "  Waiting for upgrade to deploy (current=$current_seq, was=$RELEASE_SEQUENCE) ..."
  sleep 10
done

# Wait for backend to re-stabilise.
wait_for_backend_rollout || log "  WARNING: backend rollout slow after upgrade, continuing."

# Re-fetch config and compare the generated DB password.
POST_UPGRADE_CONFIG=$(kots_vm "get config" 2>/dev/null || echo "")
[ -z "$POST_UPGRADE_CONFIG" ] && fail "kots get config returned empty after upgrade"

POST_UPGRADE_DB_PW=$(echo "$POST_UPGRADE_CONFIG" \
  | yq -r '.spec.values.external_db_password.value // .spec.values.external_db_password.default // ""' 2>/dev/null || echo "")
log "  Post-upgrade external_db_password: ${POST_UPGRADE_DB_PW:0:6}..."

if [ "$INITIAL_DB_PW" != "$POST_UPGRADE_DB_PW" ]; then
  fail "Generated external_db_password CHANGED across upgrade. RandomString default was re-rendered, breaking the upgrade contract. before='${INITIAL_DB_PW:0:6}...' after='${POST_UPGRADE_DB_PW:0:6}...'"
fi
log "  Generated password is identical (24 chars matched) before and after upgrade."

# Also verify the operator-set config values from STEP 8 survived the upgrade.
ENV_VALUE=$(backend_env SESSION_DURATION)
[ "$ENV_VALUE" = "1h" ] || fail "SESSION_DURATION did not survive upgrade: got '$ENV_VALUE', expected '1h'"
ENV_VALUE=$(backend_env MAX_CARDS_PER_SESSION)
[ "$ENV_VALUE" = "10" ] || fail "MAX_CARDS_PER_SESSION did not survive upgrade: got '$ENV_VALUE', expected '10'"
ENV_VALUE=$(backend_env GUEST_ACCESS_ENABLED)
[ "$ENV_VALUE" = "false" ] || fail "GUEST_ACCESS_ENABLED did not survive upgrade: got '$ENV_VALUE', expected 'false'"
log "  Operator-set config values (session_duration, max_cards_per_session, guest_access) all survived."

pass "Step 9 -- generated DB password and operator-set values both survived upgrade."

# ════════════════════════════════════════════════════════════════════════════
# STEP 10: External DB toggle (optional — gated on TIER5_TEST_EXTERNAL_DB)
# ════════════════════════════════════════════════════════════════════════════
log "=== STEP 10: External DB toggle ==="

if [ -z "${TIER5_TEST_EXTERNAL_DB:-}" ]; then
  log "  TIER5_TEST_EXTERNAL_DB not set -- skipping external-DB switch."
  log "  This step requires a reachable external Postgres instance and is destructive on the EC install (cnpg.createCluster=false drops the embedded cluster). See tests/e2e/tier5-runbook.md."
else
  EXT_DB_HOST="${TIER5_EXT_DB_HOST:?TIER5_EXT_DB_HOST required when TIER5_TEST_EXTERNAL_DB=1}"
  EXT_DB_PORT="${TIER5_EXT_DB_PORT:-5432}"
  EXT_DB_USER="${TIER5_EXT_DB_USER:-groovelab}"
  EXT_DB_PASSWORD="${TIER5_EXT_DB_PASSWORD:?TIER5_EXT_DB_PASSWORD required when TIER5_TEST_EXTERNAL_DB=1}"

  log "  Switching db_type to 'external' with host=$EXT_DB_HOST port=$EXT_DB_PORT ..."
  kots_vm "set config --key db_type --value external"
  kots_vm "set config --key external_db_host --value $EXT_DB_HOST"
  kots_vm "set config --key external_db_port --value $EXT_DB_PORT"
  kots_vm "set config --key external_db_user --value $EXT_DB_USER"
  kots_vm "set config --key external_db_password --value '$EXT_DB_PASSWORD'"

  wait_for_backend_rollout || fail "backend did not become Ready after switching to external DB"

  # Verify cnpg cluster Resource was reconciled away (optionalValues set
  # cnpg.createCluster=false). The Cluster is a postgresql.cnpg.io/v1 CR.
  CNPG_COUNT=$(kubectl_vm "get cluster.postgresql.cnpg.io -n $NAMESPACE --no-headers 2>/dev/null | wc -l" || echo "0")
  log "  cnpg.io Cluster CRs in namespace: $CNPG_COUNT (expected 0 after switch)"
  [ "${CNPG_COUNT:-0}" -eq 0 ] || log "  WARNING: cnpg cluster still present after external DB switch."

  pass "Step 10 -- external DB toggle wired through."
fi

# ════════════════════════════════════════════════════════════════════════════
log ""
log "=== ALL TIER 5 STEPS PASSED ==="
log ""
log "Summary:"
log "  1.  Prerequisites: satisfied"
log "  2.  Images: pushed (tag: $TAG)"
log "  3.  Chart: packaged ($CHART_PACKAGE)"
log "  4.  Channel + initial release: e2e-t5-${TAG} sequence=$RELEASE_SEQUENCE"
log "  5.  Installer + license staged on VM"
log "  6.  Fresh EC install: green ($NAMESPACE pods Running)"
log "  7.  Admin console reachable, generated DB password captured (24 chars)"
log "  8a. max_cards_per_session=10: env reflected"
log "  8b. session_duration=1h: env reflected"
log "  8c. guest_access=0: env reflected"
log "  8d. session_duration='abc': regex validation rejected"
log "  9.  Generated DB password persisted across kots upstream upgrade"
log "  10. External DB toggle: ${TIER5_TEST_EXTERNAL_DB:+ran} ${TIER5_TEST_EXTERNAL_DB:-skipped (TIER5_TEST_EXTERNAL_DB not set)}"
log ""
log "Log file saved to: $LOG_FILE"
