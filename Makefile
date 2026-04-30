# Groovelab — release packaging helpers
#
# Mirrors the CI flow in .github/workflows/release.yaml so local dev can
# exercise the exact same packaging path that CI uses. The intent is zero
# drift between `make release-unstable` and the tag-triggered release job.
#
# Convention (per CLAUDE.md "Non-Negotiables"): pass env vars AFTER the
# command, e.g. `make release-unstable VERSION=v0.1.1`, never before.
#
# Fixes GRO-kydk: `replicated release create --yaml-dir chart/` silently
# strips `.tpl` files (helpers, NOTES), producing uninstallable releases.
# We now run `helm package chart/` and pass the resulting tarball via
# `--chart`, while KOTS CRs come from `release/` via `--yaml-dir`.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

APP_SLUG ?= groovelab
CHART_DIR ?= chart
RELEASE_DIR ?= release
DIST_DIR ?= dist

# Derive CHART_VERSION from chart/Chart.yaml so `make chart-package` works
# without a git tag. CI overrides both Chart.yaml fields before packaging,
# which `make release-unstable` also does.
CHART_VERSION := $(shell yq -r '.version' $(CHART_DIR)/Chart.yaml)
CHART_TGZ := $(DIST_DIR)/$(APP_SLUG)-$(CHART_VERSION).tgz

.PHONY: help chart-deps chart-package chart-lint release-unstable clean-dist \
        pr-slug pr-channel pr-customer pr-cluster pr-install pr-test pr-teardown \
        _require-version _require-token _require-not-main

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m [VAR=value ...]\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Conventions:"
	@echo "  - Pass env vars AFTER the command, e.g. make release-unstable VERSION=v0.1.1"
	@echo "  - REPLICATED_API_TOKEN must be exported for release-unstable and pr-* targets"
	@echo ""
	@echo "Per-PR install (mirrors .github/workflows/pr.yaml; see scripts/replicated-slug.sh):"
	@echo "  make pr-slug                 # print normalized slug for current branch"
	@echo "  make pr-test                 # full local replication of pr.yaml flow"
	@echo "  make pr-test IMAGE_TAG=pr-123-abc1234  # pin chart appVersion to a specific GHCR tag"
	@echo "  make pr-teardown             # delete cluster + archive customer + archive channel"

chart-deps: ## Update chart dependencies (runs `helm dependency update`)
	helm dependency update $(CHART_DIR)

chart-lint: ## Run `helm lint` on the chart
	helm lint $(CHART_DIR)

chart-package: chart-deps ## Package chart/ into dist/groovelab-<version>.tgz (reads version from Chart.yaml)
	@mkdir -p $(DIST_DIR)
	helm package $(CHART_DIR) --destination $(DIST_DIR)
	@echo ""
	@echo "Packaged: $(CHART_TGZ)"
	@echo "Verifying helpers are present in the tarball..."
	@tar tzf $(CHART_TGZ) | grep -E '(_helpers\.tpl|NOTES\.txt)$$' || { \
		echo "FAIL: _helpers.tpl or NOTES.txt missing from packaged chart"; exit 1; }
	@echo "OK: helpers and NOTES preserved."

clean-dist: ## Remove dist/ (packaged chart tarballs)
	rm -rf $(DIST_DIR)

# ---------------------------------------------------------------------------
# release-unstable: end-to-end local equivalent of the release-unstable
# GitHub Actions job. Bumps Chart.yaml + release/helmchart.yaml to VERSION,
# packages chart, creates a Replicated release on Unstable, passing the
# packaged chart via --chart and KOTS CRs via --yaml-dir release/.
#
# Usage:
#   make release-unstable VERSION=v0.1.1
# ---------------------------------------------------------------------------
release-unstable: _require-version _require-token chart-lint ## Cut a local Unstable release (requires VERSION=vX.Y.Z and REPLICATED_API_TOKEN)
	@set -euo pipefail; \
	CHART_SEMVER="$${VERSION#v}"; \
	APP_VERSION="$${VERSION}"; \
	echo "==> Syncing $(CHART_DIR)/Chart.yaml to version=$${CHART_SEMVER} appVersion=$${APP_VERSION}"; \
	yq -i ".version = \"$${CHART_SEMVER}\"" $(CHART_DIR)/Chart.yaml; \
	yq -i ".appVersion = \"$${APP_VERSION}\"" $(CHART_DIR)/Chart.yaml; \
	echo "==> Syncing $(RELEASE_DIR)/helmchart.yaml chartVersion=$${CHART_SEMVER}"; \
	yq -i ".spec.chart.chartVersion = \"$${CHART_SEMVER}\"" $(RELEASE_DIR)/helmchart.yaml; \
	echo "==> Updating chart dependencies"; \
	helm dependency update $(CHART_DIR); \
	echo "==> Packaging chart into $(RELEASE_DIR)/ (co-located with KOTS CRs for --yaml-dir)"; \
	helm package $(CHART_DIR) --destination $(RELEASE_DIR); \
	CHART_TGZ="$(RELEASE_DIR)/$(APP_SLUG)-$${CHART_SEMVER}.tgz"; \
	echo "==> Verifying helpers preserved in $${CHART_TGZ}"; \
	tar tzf "$${CHART_TGZ}" | grep -E '(_helpers\.tpl|NOTES\.txt)$$' >/dev/null || { \
		echo "FAIL: packaged chart missing _helpers.tpl or NOTES.txt"; \
		rm -f "$${CHART_TGZ}"; \
		exit 1; \
	}; \
	trap 'rm -f $${CHART_TGZ}' EXIT; \
	echo "==> Creating Replicated release on Unstable"; \
	replicated release create \
		--yaml-dir $(RELEASE_DIR) \
		--promote Unstable \
		--version "$${VERSION}" \
		--app $(APP_SLUG); \
	echo ""; \
	echo "OK: release $${VERSION} promoted to Unstable (app: $(APP_SLUG))."

_require-version:
	@if [ -z "$${VERSION:-}" ]; then \
		echo "ERROR: VERSION is required, e.g. make release-unstable VERSION=v0.1.1"; \
		exit 2; \
	fi

_require-token:
	@if [ -z "$${REPLICATED_API_TOKEN:-}" ]; then \
		echo "ERROR: REPLICATED_API_TOKEN is not set. Export it via your shell or .envrc."; \
		exit 2; \
	fi

_require-not-main:
	@CUR=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$CUR" = "main" ] || [ "$$CUR" = "master" ]; then \
		echo "ERROR: refusing to run per-PR target on branch '$$CUR'. Check out a feature branch first."; \
		exit 2; \
	fi

# ---------------------------------------------------------------------------
# Per-PR Replicated install (mirror of .github/workflows/pr.yaml cmx-test job)
#
# These targets reproduce the customer-grade install path locally so devs can
# iterate without push-and-wait. The slug is derived from the current git
# branch via scripts/replicated-slug.sh — the same script that pr.yaml will
# converge on as a single source of truth (see GRO-m1bc).
#
# Flow (mirrors pr.yaml step numbering):
#   pr-slug      — print normalized slug for current branch (no side effects)
#   pr-channel   — create or reuse per-PR channel (idempotent)
#   pr-customer  — create or reuse dev customer licensed to the channel
#   pr-cluster   — provision a fresh CMX k3s cluster (1h TTL, per-run name)
#   pr-install   — package chart, release on per-PR channel, helm install via OCI
#   pr-test      — composite: channel + customer + cluster + install + smoke
#   pr-teardown  — delete cluster, archive customer, archive channel
#
# Differences from pr.yaml:
#   - Image tag: pr.yaml uses `pr-<PR>-<sha7>` from the build job. Locally we
#     don't push images per `make pr-test`; the chart's existing IMAGE_TAG is
#     what's already on GHCR. Pass IMAGE_TAG=<tag> to override the appVersion.
#   - PR_NUMBER: not available locally; we derive `0.0.0-<slug>` chart version
#     instead of `0.0.0-pr<N>`. Both are pre-release SemVer.
#   - Cluster name: `pr-<slug>-<unix-epoch>` instead of `pr-<slug>-<run-id>`.
# ---------------------------------------------------------------------------

# Resolve the slug from the current branch (or BRANCH=<override>) using the
# shared scripts/replicated-slug.sh. Uses `=` (lazy) instead of `:=` so the
# git invocation only runs when a pr-* target actually fires.
PR_BRANCH = $(shell git rev-parse --abbrev-ref HEAD)
PR_SLUG = $(shell ./scripts/replicated-slug.sh --branch "$(PR_BRANCH)")
PR_CHART_VERSION = 0.0.0-$(PR_SLUG)
PR_CUSTOMER_NAME = pr-$(PR_SLUG)
# IMAGE_TAG: override on CLI (`make pr-install IMAGE_TAG=pr-123-abc1234`) when
# the locally-built chart appVersion needs to match a specific GHCR tag. Falls
# back to the slug, which is fine for chart-only iteration but will
# ImagePullBackOff unless an image is actually published under that tag.
IMAGE_TAG ?= $(PR_SLUG)

pr-slug: ## Print the normalized slug for the current git branch
	@./scripts/replicated-slug.sh --branch "$(PR_BRANCH)"

pr-channel: _require-token ## Create or reuse the per-PR channel (idempotent)
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	if [ -z "$$SLUG" ]; then echo "ERROR: empty slug"; exit 1; fi; \
	echo "==> Channel for slug: $$SLUG"; \
	EXISTING=$$(replicated channel ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$SLUG" '.[] | select(.name == $$n) | .id // empty'); \
	if [ -n "$$EXISTING" ]; then \
	  echo "OK: reusing channel $$SLUG (ID: $$EXISTING)"; \
	else \
	  CHANNEL_JSON=$$(replicated channel create --name "$$SLUG" --app "$(APP_SLUG)" --output json); \
	  CHANNEL_ID=$$(echo "$$CHANNEL_JSON" \
	    | jq -r --arg n "$$SLUG" 'if type == "array" then (.[] | select(.name == $$n) | .id) else (.channel.id // .id // empty) end' \
	    | head -n1); \
	  if [ -z "$$CHANNEL_ID" ]; then \
	    CHANNEL_ID=$$(replicated channel ls --app "$(APP_SLUG)" --output json \
	      | jq -r --arg n "$$SLUG" '.[] | select(.name == $$n) | .id'); \
	  fi; \
	  echo "OK: channel $$SLUG created (ID: $$CHANNEL_ID)"; \
	fi

pr-customer: _require-token pr-channel ## Create or reuse the dev customer licensed to the per-PR channel
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	NAME="$(PR_CUSTOMER_NAME)"; \
	echo "==> Dev customer for slug: $$SLUG (name: $$NAME)"; \
	EXISTING=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$NAME" '.[] | select(.name == $$n) | .installationId // empty'); \
	if [ -n "$$EXISTING" ]; then \
	  echo "OK: reusing dev customer $$NAME"; \
	else \
	  CUSTOMER_JSON=$$(replicated customer create \
	    --name "$$NAME" --email "pr+$$SLUG@replicated.com" \
	    --channel "$$SLUG" --type dev \
	    --app "$(APP_SLUG)" --output json); \
	  LICENSE_ID=$$(echo "$$CUSTOMER_JSON" \
	    | jq -r --arg n "$$NAME" 'if type == "array" then (.[] | select(.name == $$n) | .installationId // empty) else (.installationId // .customer.installationId // empty) end' \
	    | head -n1); \
	  if [ -z "$$LICENSE_ID" ] || [ "$$LICENSE_ID" = "null" ]; then \
	    LICENSE_ID=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	      | jq -r --arg n "$$NAME" '.[] | select(.name == $$n) | .installationId'); \
	  fi; \
	  echo "OK: dev customer $$NAME created (no expiration)"; \
	fi

pr-cluster: _require-token _require-not-main ## Lookup-or-create the shared CMX cluster `groovelab-ci` (TTL 24h) and write per-run state
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	CLUSTER_NAME="groovelab-ci"; \
	echo "==> Looking up shared CMX cluster $$CLUSTER_NAME"; \
	CLUSTER_ID=$$(replicated cluster ls --output json \
	  | jq -r --arg n "$$CLUSTER_NAME" '[.[] | select(.name == $$n and .status == "running")][0].id // empty'); \
	if [ -z "$$CLUSTER_ID" ]; then \
	  echo "==> No running $$CLUSTER_NAME; provisioning new (TTL 24h)"; \
	  CLUSTER_JSON=$$(replicated cluster create \
	    --distribution k3s --version "1.32" \
	    --name "$$CLUSTER_NAME" --ttl 24h --wait 10m \
	    --app "$(APP_SLUG)" --output json); \
	  CLUSTER_ID=$$(echo "$$CLUSTER_JSON" \
	    | jq -r --arg n "$$CLUSTER_NAME" 'if type == "array" then (.[] | select(.name == $$n) | .id // empty) else (.id // .cluster.id // empty) end' \
	    | head -n1); \
	  echo "OK: cluster $$CLUSTER_NAME provisioned (ID: $$CLUSTER_ID)"; \
	  NEED_INFRA_INSTALL=true; \
	else \
	  echo "OK: reusing $$CLUSTER_NAME (ID: $$CLUSTER_ID)"; \
	  NEED_INFRA_INSTALL=false; \
	fi; \
	mkdir -p $(DIST_DIR); \
	echo "$$CLUSTER_ID" > $(DIST_DIR)/pr-cluster-id; \
	echo "$$CLUSTER_NAME" > $(DIST_DIR)/pr-cluster-name; \
	echo "$$NEED_INFRA_INSTALL" > $(DIST_DIR)/pr-need-infra-install; \
	replicated cluster kubeconfig "$$CLUSTER_ID" --app "$(APP_SLUG)" \
	  --output-path $(DIST_DIR)/pr-kubeconfig.yaml; \
	echo "OK: kubeconfig written to $(DIST_DIR)/pr-kubeconfig.yaml"; \
	NAMESPACE="groovelab-pr-$$SLUG"; \
	NAMESPACE="$${NAMESPACE:0:63}"; \
	NAMESPACE="$${NAMESPACE%-}"; \
	echo "$$NAMESPACE" > $(DIST_DIR)/pr-namespace; \
	echo "OK: per-PR namespace will be $$NAMESPACE"; \
	echo ""; \
	echo "Use:  export KUBECONFIG=$$PWD/$(DIST_DIR)/pr-kubeconfig.yaml"

pr-install: _require-token _require-not-main pr-channel pr-customer ## Package chart, release on per-PR channel, helm install via OCI into per-PR namespace (assumes pr-cluster ran)
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	CHART_VERSION="$(PR_CHART_VERSION)"; \
	NAME="$(PR_CUSTOMER_NAME)"; \
	if [ ! -f $(DIST_DIR)/pr-kubeconfig.yaml ]; then \
	  echo "ERROR: $(DIST_DIR)/pr-kubeconfig.yaml not found. Run 'make pr-cluster' first."; \
	  exit 1; \
	fi; \
	if [ ! -f $(DIST_DIR)/pr-namespace ]; then \
	  echo "ERROR: $(DIST_DIR)/pr-namespace not found. Run 'make pr-cluster' first."; \
	  exit 1; \
	fi; \
	NAMESPACE=$$(cat $(DIST_DIR)/pr-namespace); \
	NEED_INFRA_INSTALL=$$(cat $(DIST_DIR)/pr-need-infra-install 2>/dev/null || echo "false"); \
	export KUBECONFIG="$$PWD/$(DIST_DIR)/pr-kubeconfig.yaml"; \
	LICENSE_ID=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$NAME" '.[] | select(.name == $$n) | .installationId'); \
	if [ -z "$$LICENSE_ID" ] || [ "$$LICENSE_ID" = "null" ]; then \
	  echo "ERROR: could not resolve licenseID for $$NAME"; exit 1; \
	fi; \
	echo "==> Packaging chart at version $$CHART_VERSION (appVersion=$(IMAGE_TAG))"; \
	helm dependency update $(CHART_DIR); \
	mkdir -p $(RELEASE_DIR); \
	rm -f $(RELEASE_DIR)/$(APP_SLUG)-*.tgz; \
	helm package $(CHART_DIR) \
	  --version "$$CHART_VERSION" \
	  --app-version "$(IMAGE_TAG)" \
	  --destination /tmp/; \
	mv "/tmp/$(APP_SLUG)-$$CHART_VERSION.tgz" $(RELEASE_DIR)/; \
	echo "==> Creating release on channel $$SLUG"; \
	replicated release create \
	  --yaml-dir $(RELEASE_DIR) --promote "$$SLUG" \
	  --version "$$CHART_VERSION" --app "$(APP_SLUG)" --output json >/dev/null; \
	if [ "$$NEED_INFRA_INSTALL" = "true" ]; then \
	  echo "==> Pre-installing cluster-shared infra (CNPG + cert-manager) on fresh cluster"; \
	  (cd $(CHART_DIR)/charts && for f in cloudnative-pg-*.tgz cert-manager-*.tgz; do \
	     [ -f "$$f" ] && [ ! -d "$${f%.tgz}" ] && tar xzf "$$f" || true; \
	   done); \
	  helm upgrade --install cnpg-operator $(CHART_DIR)/charts/cloudnative-pg \
	    --namespace cnpg-system --create-namespace --wait --timeout 3m; \
	  CM_DIR=$$(ls -d $(CHART_DIR)/charts/cert-manager-* 2>/dev/null | head -1); \
	  if [ -z "$$CM_DIR" ] || [ ! -d "$$CM_DIR" ]; then CM_DIR="$(CHART_DIR)/charts/cert-manager"; fi; \
	  helm upgrade --install cert-manager "$$CM_DIR" \
	    --namespace cert-manager --create-namespace \
	    --set crds.enabled=true \
	    --wait --timeout 3m; \
	else \
	  echo "==> Reusing shared cluster — skipping CNPG + cert-manager pre-install."; \
	fi; \
	echo "==> Ensuring per-PR namespace $$NAMESPACE exists"; \
	kubectl create namespace "$$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -; \
	echo "==> helm registry login registry.replicated.com"; \
	echo "$$LICENSE_ID" | helm registry login registry.replicated.com \
	  --username "$$LICENSE_ID" --password-stdin; \
	OCI_URL="oci://registry.replicated.com/$(APP_SLUG)/$$SLUG/$(APP_SLUG)"; \
	echo "==> Verifying license injection (helm show values diagnostic)"; \
	helm show values "$$OCI_URL" --version "$$CHART_VERSION" > /tmp/injected-values.yaml; \
	if ! grep -q "dockerconfigjson:" /tmp/injected-values.yaml; then \
	  echo "FAIL: helm show values missing 'dockerconfigjson:' — license injection not firing"; \
	  head -80 /tmp/injected-values.yaml; \
	  exit 1; \
	fi; \
	echo "OK: license injection verified."; \
	echo "==> helm upgrade --install $(APP_SLUG) $$OCI_URL --version $$CHART_VERSION -n $$NAMESPACE"; \
	helm upgrade --install "$(APP_SLUG)" "$$OCI_URL" \
	  --version "$$CHART_VERSION" \
	  --namespace "$$NAMESPACE" --create-namespace \
	  --set cloudnative-pg.enabled=false \
	  --set cert-manager.enabled=false; \
	echo ""; \
	echo "==> Waiting for pods to be ready in $$NAMESPACE (5m deadline)"; \
	DEADLINE=$$(($$(date +%s) + 300)); \
	while true; do \
	  echo "[$$(date +%H:%M:%S)] Pod status:"; \
	  kubectl get pods -n "$$NAMESPACE" --no-headers 2>/dev/null || true; \
	  NOT_READY=$$(kubectl get pods -n "$$NAMESPACE" --no-headers 2>/dev/null | grep -v -E "Running|Completed" || true); \
	  [ -z "$$NOT_READY" ] && break; \
	  if [ "$$(date +%s)" -ge "$$DEADLINE" ]; then \
	    echo "TIMEOUT: pods not ready after 5 minutes"; \
	    kubectl get events -n "$$NAMESPACE" --sort-by=.lastTimestamp | tail -30; \
	    exit 1; \
	  fi; \
	  sleep 15; \
	done; \
	echo "OK: all pods running."; \
	echo "==> Smoke test: /healthz 200 + flashcards/answer 404"; \
	kubectl port-forward svc/$(APP_SLUG)-backend 18080:8080 -n "$$NAMESPACE" >/dev/null 2>&1 & \
	PF_PID=$$!; \
	sleep 5; \
	HTTP=$$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/healthz); \
	ANS=$$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:18080/api/v1/flashcards/answer); \
	kill "$$PF_PID" 2>/dev/null || true; \
	if [ "$$HTTP" != "200" ]; then echo "FAIL: /healthz=$$HTTP"; exit 1; fi; \
	if [ "$$ANS" != "404" ]; then echo "FAIL: /flashcards/answer=$$ANS (want 404)"; exit 1; fi; \
	echo "OK: /healthz=200, /flashcards/answer=404"

pr-test: _require-token _require-not-main pr-cluster pr-install ## Composite: channel + customer + cluster + install + smoke tests
	@echo ""
	@echo "PASS: pr-test green for slug $(PR_SLUG). Run 'make pr-teardown' to clean up."

pr-teardown: _require-token ## Tear down per-PR namespace, customer, and channel (shared cluster persists per GRO-e4wb)
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	NAME="$(PR_CUSTOMER_NAME)"; \
	echo "==> Tearing down per-PR resources for slug: $$SLUG"; \
	NAMESPACE=""; \
	if [ -f $(DIST_DIR)/pr-namespace ]; then \
	  NAMESPACE=$$(cat $(DIST_DIR)/pr-namespace); \
	else \
	  NAMESPACE="groovelab-pr-$$SLUG"; \
	  NAMESPACE="$${NAMESPACE:0:63}"; \
	  NAMESPACE="$${NAMESPACE%-}"; \
	fi; \
	if [ -f $(DIST_DIR)/pr-kubeconfig.yaml ]; then \
	  echo "  - Deleting namespace $$NAMESPACE from shared cluster"; \
	  KUBECONFIG="$$PWD/$(DIST_DIR)/pr-kubeconfig.yaml" \
	    kubectl delete namespace "$$NAMESPACE" --ignore-not-found --wait=false || true; \
	else \
	  echo "  - No kubeconfig at $(DIST_DIR)/pr-kubeconfig.yaml; skipping namespace delete (cluster may have TTL'd)"; \
	fi; \
	rm -f $(DIST_DIR)/pr-cluster-id $(DIST_DIR)/pr-cluster-name $(DIST_DIR)/pr-namespace $(DIST_DIR)/pr-need-infra-install $(DIST_DIR)/pr-kubeconfig.yaml; \
	CUST_ID=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$NAME" '.[] | select(.name == $$n) | .id // empty'); \
	if [ -n "$$CUST_ID" ]; then \
	  echo "  - Archiving customer $$NAME ($$CUST_ID)"; \
	  replicated customer archive "$$CUST_ID" --app "$(APP_SLUG)" || true; \
	else \
	  echo "  - No customer named $$NAME (already gone)"; \
	fi; \
	CHAN_ID=$$(replicated channel ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$SLUG" '.[] | select(.name == $$n) | .id // empty'); \
	if [ -n "$$CHAN_ID" ]; then \
	  echo "  - Archiving channel $$SLUG ($$CHAN_ID)"; \
	  replicated channel rm "$$CHAN_ID" --app "$(APP_SLUG)" || true; \
	else \
	  echo "  - No channel named $$SLUG (already gone)"; \
	fi; \
	echo "  - Shared cluster groovelab-ci persists (TTL 24h); not removed."; \
	echo "OK: teardown complete."
