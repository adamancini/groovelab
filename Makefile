# Groovelab — release packaging helpers
#
# Mirrors the CI flow in .github/workflows/release.yaml so local dev can
# exercise the exact same packaging path that CI uses. The intent is zero
# drift between `make release-unstable` and the tag-triggered release job.
#
# Convention (per AGENTS.md "Non-Negotiables"): pass env vars AFTER the
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

.PHONY: help chart-deps chart-package chart-lint chart-lint-dev chart-template release-lint lint \
        clean clean-dist clean-release clean-charts \
        check-version-sync \
        release-unstable \
        pr-slug pr-channel pr-customer pr-cluster pr-install pr-test pr-teardown \
        build build-frontend build-backend build-local build-local-backend build-local-frontend release \
        customer customer-install customer-uninstall cluster cluster-delete deploy expose smoke uat teardown \
        dev-install dev-upgrade dev-uninstall dev-watch dev-port-forward dev-pull-secret dev-setup \
        _require-version _require-version-tag _require-customer _require-cluster \
        _require-token _require-not-main

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m [VAR=value ...]\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Conventions:"
	@echo "  - Pass env vars AFTER the command: make deploy VERSION=0.1.2 CUSTOMER=foo CLUSTER=bar"
	@echo "  - REPLICATED_API_TOKEN must be exported for any target that talks to Replicated."
	@echo "  - Test/dev release tags MUST use a SemVer pre-release qualifier (v0.0.0-test.<sha>)."
	@echo "    Plain numerals like v9.9.9 poison the OCI registry's latest-tag resolution forever."
	@echo ""
	@echo "Lint:"
	@echo "  make lint                          # helm lint + replicated release lint"
	@echo "  make chart-lint                    # helm lint only"
	@echo "  make chart-lint-dev                # helm lint with dev values"
	@echo "  make chart-template                # render templates to stdout (dev values)"
	@echo "  make release-lint                  # replicated release lint only (packages chart first)"
	@echo ""
	@echo "Clean (working-tree hygiene):"
	@echo "  make clean                         # cascade: clean-dist + clean-release + clean-charts"
	@echo "  make clean-dist                    # remove dist/ (packaged tarballs from chart-package)"
	@echo "  make clean-release                 # remove release/groovelab-*.tgz only (KOTS CRs preserved)"
	@echo "  make clean-charts                  # remove untracked chart/charts/*.tgz + extracted dirs"
	@echo "  Note: after 'make clean', run 'make chart-deps' before 'helm lint' / 'make chart-lint' —"
	@echo "        Helm v4 needs --dependency-update or pre-extracted subcharts to lint."
	@echo ""
	@echo "Build & release:"
	@echo "  make build VERSION=0.1.3           # build + push frontend and backend images"
	@echo "  make build-local                   # build images locally (no push, tag latest+sha7)"
	@echo "  make release                       # dev-loop: build + package + publish to Unstable"
	@echo "                                     #           VERSION = <chart-version>+<sha7>; no git mutations"
	@echo "  make release CHANNEL=feat/topic    # dev-loop on a feature channel (slug-normalized)"
	@echo "  make release VERSION=0.1.3 PUSH=1  # CI mode: bump Chart.yaml + helmchart.yaml,"
	@echo "                                     #          commit, tag v0.1.3, push (CI takes over)"
	@echo "  make release-unstable              # alias for: make release CHANNEL=Unstable"
	@echo "  make check-version-sync            # read-only: verify Chart.yaml and helmchart.yaml agree"
	@echo ""
	@echo "Dev loop (helmfile, local chart + GHCR images):"
	@echo "  make dev-setup                     # full setup: cluster + pull-secret + helmfile sync"
	@echo "  make dev-install                   # helmfile sync (dev environment)"
	@echo "  make dev-upgrade                   # helmfile sync (dev environment)"
	@echo "  make dev-uninstall                 # helmfile destroy (dev environment)"
	@echo "  make dev-watch                     # watch pods across groovelab + cnpg-system"
	@echo "  make dev-port-forward              # port-forward frontend to https://localhost:8443"
	@echo "  make dev-pull-secret               # create GHCR imagePullSecret in namespace"
	@echo ""
	@echo "Customer install (OCI chart, proxy registry images):"
	@echo "  make customer-install LICENSE_ID=...    # install via helmfile (replicated environment)"
	@echo "  make customer-uninstall LICENSE_ID=...  # uninstall via helmfile (replicated environment)"
	@echo ""
	@echo "Deploy & UAT (any cluster, any customer):"
	@echo "  make customer NAME=uat-v0.1.3 CHANNEL=Unstable"
	@echo "  make cluster NAME=uat-v0-1-3 TTL=2h"
	@echo "  make cluster-delete CLUSTER=uat-v0-1-3   # delete cluster, remove kubeconfig"
	@echo "  make deploy VERSION=0.1.2 CUSTOMER=uat-v0.1.3 CLUSTER=uat-v0-1-3"
	@echo "  make expose CLUSTER=uat-v0-1-3                 # public ingress URL (rke2/EC clusters only)"
	@echo "  make uat VERSION=0.1.2 CHANNEL=Unstable        # composite of the three above + smoke"
	@echo "  make smoke NAMESPACE=groovelab CLUSTER=uat-v0-1-3"
	@echo "  make teardown CUSTOMER=uat-v0.1.3 CLUSTER=uat-v0-1-3"
	@echo ""
	@echo "Per-PR install (mirrors .github/workflows/pr.yaml):"
	@echo "  make pr-slug                 # print normalized slug for current branch"
	@echo "  make pr-test                 # full local replication of pr.yaml flow"
	@echo "  make pr-teardown             # delete namespace + archive customer + channel"

chart-deps: ## Update chart dependencies (runs `helm dependency update`)
	helm dependency update $(CHART_DIR)

chart-lint: ## Run `helm lint` on the chart
	helm lint $(CHART_DIR)

chart-lint-dev: chart-deps ## Run `helm lint` on the chart with dev values
	helm lint $(CHART_DIR) -f $(CHART_DIR)/values.yaml -f $(CHART_DIR)/values-dev.yaml

chart-template: chart-deps ## Render chart templates to stdout (dev environment)
	helm template $(APP_SLUG) $(CHART_DIR) \
	  -f $(CHART_DIR)/values.yaml \
	  -f $(CHART_DIR)/values-dev.yaml \
	  --set cloudnative-pg.enabled=false

# release-lint runs `replicated release lint` against the release/ directory
# AFTER packaging the chart into it. The chart tarball must be co-located with
# the KOTS CRs because `--yaml-dir` is mutually exclusive with `--chart` (Entry
# 13). This catches KOTS Application/HelmChart/EmbeddedCluster Config issues
# before they hit `replicated release create`. CI runs the equivalent inline
# during release-unstable; this target lets a local dev shake out the same
# linter findings without provisioning anything.
release-lint: _require-token chart-deps ## Run `replicated release lint` on packaged chart + KOTS CRs in release/
	@set -euo pipefail; \
	CHART_VER=$$(yq -r '.version' $(CHART_DIR)/Chart.yaml); \
	CHART_TGZ="$(RELEASE_DIR)/$(APP_SLUG)-$${CHART_VER}.tgz"; \
	echo "==> Packaging chart into $(RELEASE_DIR)/ for lint"; \
	rm -f $(RELEASE_DIR)/$(APP_SLUG)-*.tgz; \
	helm package $(CHART_DIR) --destination $(RELEASE_DIR) >/dev/null; \
	trap 'rm -f $${CHART_TGZ}' EXIT; \
	echo "==> replicated release lint --yaml-dir $(RELEASE_DIR)"; \
	replicated release lint --yaml-dir $(RELEASE_DIR) --app $(APP_SLUG); \
	echo ""; \
	echo "OK: release lint clean."

lint: check-version-sync chart-lint release-lint ## Run check-version-sync + helm lint + replicated release lint
	@echo ""
	@echo "OK: all linters green."

# check-version-sync: read-only guard ensuring chart/Chart.yaml.version and
# release/helmchart.yaml.spec.chart.chartVersion are equal. Wired into `make
# lint` so CI / pre-commit / local lint all reject drift between the two
# version sources of truth. Never mutates either file. Exit 0 on match,
# exit 2 on mismatch with both labeled values printed.
check-version-sync: ## Verify chart/Chart.yaml.version equals release/helmchart.yaml.spec.chart.chartVersion (read-only)
	@set -euo pipefail; \
	CHART_V=$$(yq -r '.version' $(CHART_DIR)/Chart.yaml); \
	HELM_V=$$(yq -r '.spec.chart.chartVersion' $(RELEASE_DIR)/helmchart.yaml); \
	if [ "$$CHART_V" = "$$HELM_V" ]; then \
	  echo "OK: chart/Chart.yaml.version == release/helmchart.yaml.spec.chart.chartVersion ($$CHART_V)"; \
	  exit 0; \
	fi; \
	echo "ERROR: chart version drift detected." >&2; \
	echo "  chart/Chart.yaml.version                          = $$CHART_V" >&2; \
	echo "  release/helmchart.yaml.spec.chart.chartVersion    = $$HELM_V" >&2; \
	echo "" >&2; \
	echo "Fix: bump both files to the same value, then re-run 'make check-version-sync'." >&2; \
	exit 2

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
# Single-tarball-before-package invariant
#
# Any target that runs `helm package --destination $(RELEASE_DIR)` MUST first
# run `rm -f $(RELEASE_DIR)/$(APP_SLUG)-*.tgz`. `replicated release create
# --yaml-dir release/` packages every tarball it finds in that directory into
# the release manifest, so a stale tarball from a prior version would silently
# corrupt the release. Targets that package into release/: release-lint,
# release-unstable, pr-install. Each of them does the rm -f before helm
# package; clean-release codifies the cleanup as a one-liner dependency for
# any future packaging target.
# ---------------------------------------------------------------------------

clean-release: ## Remove only release/$(APP_SLUG)-*.tgz (preserves KOTS CRs)
	@set -euo pipefail; \
	REMOVED=$$(ls $(RELEASE_DIR)/$(APP_SLUG)-*.tgz 2>/dev/null || true); \
	rm -f $(RELEASE_DIR)/$(APP_SLUG)-*.tgz; \
	if [ -n "$$REMOVED" ]; then \
	  echo "Removed packaged chart tarballs from $(RELEASE_DIR)/:"; \
	  echo "$$REMOVED" | sed 's/^/  /'; \
	else \
	  echo "OK: no packaged chart tarballs to remove from $(RELEASE_DIR)/."; \
	fi

clean-charts: ## Remove untracked $(CHART_DIR)/charts/*.tgz and extracted subchart dirs (refuses if any tracked)
	@set -euo pipefail; \
	if [ ! -d $(CHART_DIR)/charts ]; then \
	  echo "OK: $(CHART_DIR)/charts/ does not exist; nothing to clean."; \
	  exit 0; \
	fi; \
	TRACKED=$$(git ls-files $(CHART_DIR)/charts/ 2>/dev/null || true); \
	if [ -n "$$TRACKED" ]; then \
	  echo "ERROR: $(CHART_DIR)/charts/ contains TRACKED files; refusing to clean."; \
	  echo "       Tracked paths:"; \
	  echo "$$TRACKED" | sed 's/^/         /'; \
	  echo "       Investigate before manual cleanup. clean-charts only removes untracked artifacts."; \
	  exit 1; \
	fi; \
	REMOVED_TGZ=$$(ls $(CHART_DIR)/charts/*.tgz 2>/dev/null || true); \
	rm -f $(CHART_DIR)/charts/*.tgz; \
	REMOVED_DIRS=""; \
	for d in $(CHART_DIR)/charts/*/; do \
	  [ -d "$$d" ] || continue; \
	  REMOVED_DIRS="$$REMOVED_DIRS $$d"; \
	  rm -rf "$$d"; \
	done; \
	if [ -n "$$REMOVED_TGZ" ] || [ -n "$$REMOVED_DIRS" ]; then \
	  echo "Removed untracked artifacts from $(CHART_DIR)/charts/:"; \
	  [ -n "$$REMOVED_TGZ" ] && echo "$$REMOVED_TGZ" | sed 's/^/  tgz: /'; \
	  for d in $$REMOVED_DIRS; do echo "  dir: $$d"; done; \
	else \
	  echo "OK: no untracked artifacts in $(CHART_DIR)/charts/."; \
	fi

clean: clean-dist clean-release clean-charts ## Cascade clean-dist + clean-release + clean-charts (full reset of working artifacts)
	@echo ""
	@echo "OK: working tree clean. Run 'make chart-deps' to repopulate $(CHART_DIR)/charts/ before chart-lint or release."

# ---------------------------------------------------------------------------
# release-unstable: thin alias for `make release CHANNEL=Unstable`. Kept for
# back-compat with docs / CI / muscle-memory; the real implementation lives in
# the unified `release` target below (dev-loop default + optional PUSH=1 CI
# mode). See GRO-lxiv. The single-tarball invariant called out above is
# enforced by `make release` itself (which runs `clean-release` before
# `helm package`), so no separate `rm -f` is needed in this alias.
# ---------------------------------------------------------------------------
release-unstable: ## Alias for `make release CHANNEL=Unstable` (back-compat)
	@$(MAKE) release CHANNEL=Unstable $(if $(VERSION),VERSION=$(VERSION),) $(if $(PUSH),PUSH=$(PUSH),)

_require-version:
	@if [ -z "$${VERSION:-}" ]; then \
		echo "ERROR: VERSION is required, e.g. make release-unstable VERSION=v0.1.1"; \
		exit 2; \
	fi

_require-token:
	@if [ -n "$${REPLICATED_API_TOKEN:-}" ]; then exit 0; fi; \
	if replicated app ls --app $(APP_SLUG) >/dev/null 2>&1; then exit 0; fi; \
	echo "ERROR: Replicated CLI is not authenticated."; \
	echo "       Run 'replicated login' or export REPLICATED_API_TOKEN."; \
	exit 2

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
	    --distribution k3s --version "1.34" \
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

# ---------------------------------------------------------------------------
# General-purpose build / release / deploy / UAT targets.
#
# These exist so a contributor can clone the repo and run `make build`,
# `make release`, `make deploy` with explicit parameters — no agent required.
# Per-PR development uses the pr-* family above; these handle everything else
# (release cuts, UAT against Unstable/Stable, ad-hoc cluster installs).
#
# Required parameters per target:
#   build:    VERSION=<semver>                         # 0.1.3 or v0.1.3
#   release:  VERSION=<vX.Y.Z>                         # must start with 'v'
#   customer: NAME=<customer-name> CHANNEL=<channel>   # CHANNEL defaults Unstable
#   cluster:  NAME=<cluster-name>                      # TTL defaults 2h
#   deploy:   VERSION=<chart-version> CUSTOMER=<name>  # CLUSTER must already exist
#             CLUSTER=<cluster-name>
#   smoke:    CLUSTER=<cluster-name>                   # NAMESPACE defaults groovelab
#   uat:      VERSION=<chart-version>                  # composite; creates customer + cluster
#   teardown: CUSTOMER=<name> CLUSTER=<name>           # archives customer, deletes cluster
# ---------------------------------------------------------------------------

CHANNEL ?= Unstable
NAMESPACE ?= $(APP_SLUG)
TTL ?= 2h
K8S_DISTRIBUTION ?= k3s
K8S_VERSION ?= 1.34
GHCR_OWNER ?= adamancini
GHCR_BACKEND := ghcr.io/$(GHCR_OWNER)/$(APP_SLUG)-backend
GHCR_FRONTEND := ghcr.io/$(GHCR_OWNER)/$(APP_SLUG)-frontend

# Strip a leading 'v' from VERSION so chart-version (SemVer numerals) and
# image-tag (v-prefixed) stay consistent. Both forms accepted on input.
CHART_VER = $(VERSION:v%=%)
APP_VER ?= v$(CHART_VER)

# ---------- build ----------------------------------------------------------

build: build-backend build-frontend ## Build and push both images for VERSION (multi-arch via buildx)

build-backend: _require-version ## Build and push backend image for VERSION
	@set -euo pipefail; \
	echo "==> Building $(GHCR_BACKEND):$(APP_VER) (linux/amd64)"; \
	docker buildx build \
	  --platform linux/amd64 \
	  --tag "$(GHCR_BACKEND):$(APP_VER)" \
	  --push \
	  ./backend
	@echo "OK: $(GHCR_BACKEND):$(APP_VER) pushed."

build-frontend: _require-version ## Build and push frontend image for VERSION
	@set -euo pipefail; \
	echo "==> Building $(GHCR_FRONTEND):$(APP_VER) (linux/amd64)"; \
	docker buildx build \
	  --platform linux/amd64 \
	  --tag "$(GHCR_FRONTEND):$(APP_VER)" \
	  --push \
	  ./frontend
	@echo "OK: $(GHCR_FRONTEND):$(APP_VER) pushed."

# SHA7 is used for local-only image tags (no VERSION required).
SHA7 := $(shell git rev-parse --short HEAD)

build-local: build-local-backend build-local-frontend ## Build both images locally (no push, tag latest+SHA7)
	@echo "OK: local images built ($(SHA7) + latest)."

build-local-backend: ## Build backend image locally (no push, tag latest+SHA7)
	@set -euo pipefail; \
	echo "==> Building $(GHCR_BACKEND):$(SHA7) (linux/amd64)"; \
	docker buildx build \
	  --platform linux/amd64 \
	  --tag "$(GHCR_BACKEND):$(SHA7)" \
	  --tag "$(GHCR_BACKEND):latest" \
	  ./backend
	@echo "OK: $(GHCR_BACKEND):$(SHA7) built."

build-local-frontend: ## Build frontend image locally (no push, tag latest+SHA7)
	@set -euo pipefail; \
	echo "==> Building $(GHCR_FRONTEND):$(SHA7) (linux/amd64)"; \
	docker buildx build \
	  --platform linux/amd64 \
	  --tag "$(GHCR_FRONTEND):$(SHA7)" \
	  --tag "$(GHCR_FRONTEND):latest" \
	  ./frontend
	@echo "OK: $(GHCR_FRONTEND):$(SHA7) built."

# ---------- dev loop (helmfile) --------------------------------------------
#
# Local development install via helmfile. Assumes images are already pushed
# (CI or `make build`) and a cluster with valid KUBECONFIG exists.
# For a fresh CMX cluster, run `make cluster NAME=...` first, then
# `make dev-pull-secret dev-install`.
# ---------------------------------------------------------------------------

HELMFILE_ENV ?= dev

DEV_CLUSTER_NAME ?= groovelab-dev

dev-install: ## Install groovelab via helmfile (dev environment, local chart + GHCR images)
	HELMFILE_ENVIRONMENT=$(HELMFILE_ENV) helmfile sync

dev-upgrade: ## Upgrade groovelab via helmfile (dev environment)
	HELMFILE_ENVIRONMENT=$(HELMFILE_ENV) helmfile sync

dev-uninstall: ## Uninstall groovelab via helmfile (dev environment)
	HELMFILE_ENVIRONMENT=$(HELMFILE_ENV) helmfile destroy

dev-watch: ## Watch pod status across groovelab and cnpg-system namespaces
	kubectl get pods -n $(NAMESPACE) -n cnpg-system -w

dev-port-forward: ## Port-forward groovelab frontend to https://localhost:8443
	@echo "Forwarding https://localhost:8443 -> $(APP_SLUG)-frontend:443"
	@echo "App available at https://localhost:8443 (nginx handles TLS termination internally)"
	kubectl port-forward -n $(NAMESPACE) svc/$(APP_SLUG)-frontend 8443:443

dev-pull-secret: ## Create the GHCR imagePullSecret in the $(NAMESPACE) namespace (reads docker-credential-desktop)
	@set -euo pipefail; \
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -; \
	GHCR_USER=$$(docker-credential-desktop get <<< "ghcr.io" 2>/dev/null \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Username'])"); \
	GHCR_TOKEN=$$(docker-credential-desktop get <<< "ghcr.io" 2>/dev/null \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Secret'])"); \
	kubectl create secret docker-registry ghcr-pull-secret \
	  --namespace $(NAMESPACE) \
	  --docker-server=ghcr.io \
	  --docker-username="$$GHCR_USER" \
	  --docker-password="$$GHCR_TOKEN" \
	  --dry-run=client -o yaml | kubectl apply -f -; \
	echo "ghcr-pull-secret created/updated."

dev-setup: ## Full dev setup: create CMX cluster, pull GHCR secret, install app
	$(MAKE) cluster NAME=$(DEV_CLUSTER_NAME)
	$(MAKE) dev-pull-secret
	HELMFILE_ENVIRONMENT=$(HELMFILE_ENV) helmfile sync
	@echo ""
	@echo "Dev setup complete. Run 'make dev-watch' to follow pod status."

# ---------- release --------------------------------------------------------
#
# Two paths through the same target (GRO-lxiv):
#
#   1. DEV-LOOP DEFAULT (`make release`, no PUSH):
#        - VERSION = `<chart-version>+<sha7>` (build-metadata SemVer) unless
#          the user overrides VERSION explicitly.
#        - CHANNEL defaults to Unstable; CHANNEL=feat/topic gets normalized
#          through scripts/replicated-slug.sh to a Replicated-friendly slug.
#        - Builds + pushes images, packages chart with --version/--app-version
#          (no on-disk Chart.yaml mutation), and `replicated release create`s.
#        - Working tree stays clean. No git commits, no tags, no pushes.
#
#   2. CI / PUBLISH MODE (`make release VERSION=0.1.3 PUSH=1`):
#        - The ONLY mode that mutates files / commits / tags / pushes.
#        - VERSION must be a clean SemVer (no pre-release, no build metadata)
#          and is enforced by `_require-version-tag`.
#        - Refuses on dirty tree, non-main branch, or pre-existing tag.
#        - Bumps chart/Chart.yaml + release/helmchart.yaml in lockstep,
#          commits, tags v$VERSION, pushes branch + tag. CI release.yaml then
#          takes over (build → Cosign-OIDC sign → release create → promote).
#        - Local does NOT call `replicated release create` here — CI is the
#          source of truth in PUSH=1 mode.
# ---------------------------------------------------------------------------

# Lazy-evaluated helpers so `make help` / unrelated targets don't pay for
# the git or yq invocations.
RELEASE_CHART_VERSION = $(shell yq -r '.version' $(CHART_DIR)/Chart.yaml)
RELEASE_SHA7 = $(shell git rev-parse --short HEAD)
RELEASE_BRANCH = $(shell git rev-parse --abbrev-ref HEAD)
# RELEASE_VERSION: explicit VERSION wins; otherwise default to
# `<chart-version>+<sha7>` per SemVer build-metadata convention. The leading
# `v` is stripped if present so chart/Chart.yaml.version stays SemVer-clean.
RELEASE_VERSION = $(if $(VERSION),$(VERSION:v%=%),$(RELEASE_CHART_VERSION)+$(RELEASE_SHA7))

release: ## Dev-loop release to Unstable (default) OR CI publish mode (PUSH=1)
	@set -euo pipefail; \
	if [ "$${PUSH:-}" = "1" ]; then \
	  $(MAKE) _release-push; \
	else \
	  $(MAKE) _release-dev; \
	fi

# ---------- release: dev-loop path ----------------------------------------

.PHONY: _release-dev _release-push

_release-dev: _require-token chart-deps ## (internal) Dev-loop publish to Unstable / feature channel; no git mutations
	@set -euo pipefail; \
	CHANNEL="$${CHANNEL:-Unstable}"; \
	if [ "$$CHANNEL" = "Unstable" ] || [ "$$CHANNEL" = "Stable" ]; then \
	  CHANNEL_SLUG="$$CHANNEL"; \
	else \
	  CHANNEL_SLUG=$$(./scripts/replicated-slug.sh --branch "$$CHANNEL"); \
	  if [ -z "$$CHANNEL_SLUG" ]; then \
	    echo "ERROR: CHANNEL=$$CHANNEL normalized to empty slug." >&2; exit 2; \
	  fi; \
	fi; \
	REL_VERSION="$(RELEASE_VERSION)"; \
	REL_VERSION_TAG=$$(printf '%s' "$$REL_VERSION" | tr '+' '_'); \
	APP_VER="v$$REL_VERSION_TAG"; \
	echo "==> Dev-loop release"; \
	echo "    chart-version (Chart.yaml on-disk):       $(RELEASE_CHART_VERSION)"; \
	echo "    sha7:                                     $(RELEASE_SHA7)"; \
	echo "    release VERSION (chart SemVer, with +):   $$REL_VERSION"; \
	echo "    image / OCI tag (+ → _ for OCI/Docker):   $$REL_VERSION_TAG"; \
	echo "    appVersion (image tag wired into chart):  $$APP_VER"; \
	echo "    CHANNEL:                                  $$CHANNEL"; \
	echo "    CHANNEL_SLUG (replicated channel name):   $$CHANNEL_SLUG"; \
	echo "==> Building + pushing images for $$APP_VER"; \
	$(MAKE) build VERSION="$$REL_VERSION_TAG"; \
	if [ "$$CHANNEL_SLUG" != "Unstable" ] && [ "$$CHANNEL_SLUG" != "Stable" ]; then \
	  echo "==> Ensuring channel $$CHANNEL_SLUG exists on Replicated (idempotent)"; \
	  EXISTING=$$(replicated channel ls --app "$(APP_SLUG)" --output json \
	    | jq -r --arg n "$$CHANNEL_SLUG" '.[] | select(.name == $$n) | .id // empty'); \
	  if [ -z "$$EXISTING" ]; then \
	    replicated channel create --name "$$CHANNEL_SLUG" --app "$(APP_SLUG)" --output json >/dev/null; \
	    echo "OK: channel $$CHANNEL_SLUG created"; \
	  else \
	    echo "OK: reusing channel $$CHANNEL_SLUG (id: $$EXISTING)"; \
	  fi; \
	fi; \
	echo "==> Single-tarball invariant: clearing $(RELEASE_DIR)/$(APP_SLUG)-*.tgz"; \
	rm -f $(RELEASE_DIR)/$(APP_SLUG)-*.tgz; \
	echo "==> helm package $(CHART_DIR) --version $$REL_VERSION --app-version $$APP_VER --destination $(RELEASE_DIR)"; \
	helm package $(CHART_DIR) \
	  --version "$$REL_VERSION" \
	  --app-version "$$APP_VER" \
	  --destination $(RELEASE_DIR) >/dev/null; \
	REL_TGZ="$(RELEASE_DIR)/$(APP_SLUG)-$$REL_VERSION.tgz"; \
	if [ ! -f "$$REL_TGZ" ]; then \
	  echo "ERROR: expected $$REL_TGZ not found after helm package" >&2; exit 1; \
	fi; \
	echo "==> Verifying helpers preserved in $$REL_TGZ"; \
	tar tzf "$$REL_TGZ" | grep -E '(_helpers\.tpl|NOTES\.txt)$$' >/dev/null || { \
	  echo "FAIL: packaged chart missing _helpers.tpl or NOTES.txt" >&2; exit 1; \
	}; \
	echo "==> replicated release create --yaml-dir $(RELEASE_DIR) --promote $$CHANNEL_SLUG --version $$REL_VERSION"; \
	if ! replicated release create \
	    --yaml-dir $(RELEASE_DIR) \
	    --promote "$$CHANNEL_SLUG" \
	    --version "$$REL_VERSION" \
	    --app "$(APP_SLUG)"; then \
	  echo "" >&2; \
	  echo "NOTE: if this rejected the '+' in the version, retry with VERSION=$$REL_VERSION_TAG (the OCI-safe form)." >&2; \
	  exit 1; \
	fi; \
	echo ""; \
	echo "OK: $$REL_VERSION published to channel $$CHANNEL_SLUG (app: $(APP_SLUG))."; \
	echo ""; \
	echo "Install (license-injected):"; \
	echo "  helm registry login registry.replicated.com -u <license-id> -p <license-id>"; \
	echo "  helm install $(APP_SLUG) oci://registry.replicated.com/$(APP_SLUG)/$$(echo $$CHANNEL_SLUG | tr '[:upper:]' '[:lower:]')/$(APP_SLUG) \\"; \
	echo "    --version $$REL_VERSION"

# ---------- release: PUSH=1 (CI publish) path -----------------------------

_release-push: _require-version-tag ## (internal) PUSH=1 mode: bump chart files, commit, tag, push (CI takes over)
	@set -euo pipefail; \
	if ! git diff --quiet || ! git diff --cached --quiet; then \
	  echo "ERROR: working tree is dirty. Commit or stash before releasing." >&2; \
	  exit 1; \
	fi; \
	CUR=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$CUR" != "main" ]; then \
	  echo "ERROR: release must be cut from main; currently on $$CUR." >&2; \
	  exit 1; \
	fi; \
	TAG="$(VERSION)"; \
	case "$$TAG" in \
	  v*) ;; \
	  *) TAG="v$$TAG" ;; \
	esac; \
	if git rev-parse "$$TAG" >/dev/null 2>&1; then \
	  echo "ERROR: tag $$TAG already exists locally." >&2; exit 1; \
	fi; \
	if git ls-remote --tags origin "$$TAG" 2>/dev/null | grep -q "refs/tags/$$TAG"; then \
	  echo "ERROR: tag $$TAG already exists on origin." >&2; exit 1; \
	fi; \
	CHART_SEMVER="$${TAG#v}"; \
	APP_VERSION="$$TAG"; \
	echo "==> PUSH=1 mode: bumping chart files for $$TAG"; \
	echo "    $(CHART_DIR)/Chart.yaml: version=$$CHART_SEMVER appVersion=$$APP_VERSION"; \
	yq -i ".version = \"$$CHART_SEMVER\"" $(CHART_DIR)/Chart.yaml; \
	yq -i ".appVersion = \"$$APP_VERSION\"" $(CHART_DIR)/Chart.yaml; \
	echo "    $(RELEASE_DIR)/helmchart.yaml: spec.chart.chartVersion=$$CHART_SEMVER"; \
	yq -i ".spec.chart.chartVersion = \"$$CHART_SEMVER\"" $(RELEASE_DIR)/helmchart.yaml; \
	echo "==> Verifying check-version-sync after bump"; \
	$(MAKE) --no-print-directory check-version-sync; \
	echo "==> git add chart/Chart.yaml release/helmchart.yaml"; \
	git add $(CHART_DIR)/Chart.yaml $(RELEASE_DIR)/helmchart.yaml; \
	echo "==> git commit -m 'release: $$TAG'"; \
	git commit -m "release: $$TAG"; \
	echo "==> git tag -a $$TAG -m 'Release $$TAG'"; \
	git tag -a "$$TAG" -m "Release $$TAG"; \
	echo "==> git push origin main && git push origin $$TAG"; \
	git push origin main; \
	git push origin "$$TAG"; \
	echo ""; \
	echo "OK: $$TAG pushed. CI release.yaml is now running."; \
	echo "Watch:  gh run watch \$$(gh run list --workflow=release.yaml --limit 1 --json databaseId -q '.[0].databaseId')"; \
	echo ""; \
	echo "Promote to Stable (after Unstable validation):"; \
	echo "  gh workflow run promote-stable.yaml -f version=$$TAG"

# ---------- customer / cluster primitives ----------------------------------

customer: _require-token ## Create a dev customer NAME on CHANNEL (idempotent; no expiration)
	@set -euo pipefail; \
	if [ -z "$${NAME:-}" ]; then echo "ERROR: NAME=<customer-name> is required."; exit 2; fi; \
	echo "==> Customer $$NAME on channel $(CHANNEL)"; \
	EXISTING=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$NAME" '.[] | select(.archivedAt == null) | select(.name == $$n) | .installationId // empty'); \
	if [ -n "$$EXISTING" ]; then \
	  echo "OK: reusing customer $$NAME (license_id: $$EXISTING)"; \
	else \
	  CUSTOMER_JSON=$$(replicated customer create \
	    --name "$$NAME" --email "$$NAME@groovelab.test" \
	    --channel "$(CHANNEL)" --type dev \
	    --app "$(APP_SLUG)" --output json); \
	  LICENSE_ID=$$(echo "$$CUSTOMER_JSON" | jq -r '.installationId // .customer.installationId // empty'); \
	  echo "OK: customer $$NAME created (license_id: $$LICENSE_ID, no expiration)"; \
	fi

customer-install: ## Install groovelab as a Replicated customer via helmfile (requires LICENSE_ID env var)
	@set -euo pipefail; \
	if [ -z "$${LICENSE_ID:-}" ]; then \
	  echo "ERROR: LICENSE_ID env var is required."; \
	  echo "  export LICENSE_ID=<your-license-id>"; \
	  exit 1; \
	fi; \
	echo "$$LICENSE_ID" | helm registry login registry.replicated.com \
	  --username "$$LICENSE_ID" --password-stdin; \
	echo "==> Installing groovelab (replicated environment) via helmfile..."; \
	HELMFILE_ENVIRONMENT=replicated helmfile sync

customer-uninstall: ## Uninstall groovelab as a Replicated customer via helmfile (requires LICENSE_ID env var)
	@set -euo pipefail; \
	if [ -z "$${LICENSE_ID:-}" ]; then \
	  echo "ERROR: LICENSE_ID env var is required."; \
	  exit 1; \
	fi; \
	echo "==> Uninstalling groovelab (replicated environment) via helmfile..."; \
	HELMFILE_ENVIRONMENT=replicated helmfile destroy

cluster: _require-token ## Provision a CMX cluster NAME (TTL 2h, k3s 1.34, idempotent)
	@set -euo pipefail; \
	if [ -z "$${NAME:-}" ]; then echo "ERROR: NAME=<cluster-name> is required."; exit 2; fi; \
	echo "==> Cluster $$NAME ($(K8S_DISTRIBUTION) $(K8S_VERSION), TTL $(TTL))"; \
	EXISTING=$$(replicated cluster ls --output json \
	  | jq -r --arg n "$$NAME" '[.[] | select(.name == $$n and .status == "running")][0].id // empty'); \
	if [ -n "$$EXISTING" ]; then \
	  echo "OK: reusing cluster $$NAME (id: $$EXISTING)"; \
	  CLUSTER_ID="$$EXISTING"; \
	else \
	  CLUSTER_JSON=$$(replicated cluster create \
	    --distribution $(K8S_DISTRIBUTION) --version $(K8S_VERSION) \
	    --name "$$NAME" --ttl $(TTL) --wait 10m \
	    --app "$(APP_SLUG)" --output json); \
	  CLUSTER_ID=$$(echo "$$CLUSTER_JSON" | jq -r '.id // .cluster.id // empty'); \
	  echo "OK: cluster $$NAME provisioned (id: $$CLUSTER_ID)"; \
	fi; \
	mkdir -p $(DIST_DIR); \
	replicated cluster kubeconfig "$$CLUSTER_ID" --app "$(APP_SLUG)" \
	  --output-path "$(DIST_DIR)/$$NAME-kubeconfig.yaml"; \
	echo "OK: kubeconfig written to $(DIST_DIR)/$$NAME-kubeconfig.yaml"; \
	echo ""; \
	echo "Use:  export KUBECONFIG=$$PWD/$(DIST_DIR)/$$NAME-kubeconfig.yaml"

cluster-delete: _require-token _require-cluster ## Delete CLUSTER (kubeconfig removed; no customer archival)
	@set -euo pipefail; \
	CLUSTER_ID=$$(replicated cluster ls --output json \
	  | jq -r --arg n "$(CLUSTER)" '[.[] | select(.name == $$n)][0].id // empty'); \
	if [ -n "$$CLUSTER_ID" ]; then \
	  echo "==> Deleting cluster $(CLUSTER) ($$CLUSTER_ID)"; \
	  replicated cluster rm "$$CLUSTER_ID" --app "$(APP_SLUG)" || true; \
	else \
	  echo "==> Cluster $(CLUSTER) already gone"; \
	fi; \
	rm -f $(DIST_DIR)/$(CLUSTER)-kubeconfig.yaml; \
	echo "OK: cluster deleted."

# ---------- deploy ---------------------------------------------------------

deploy: _require-token _require-version _require-customer _require-cluster ## Customer-grade install of VERSION on CLUSTER as CUSTOMER
	@set -euo pipefail; \
	KUBECONFIG_PATH="$(DIST_DIR)/$(CLUSTER)-kubeconfig.yaml"; \
	if [ ! -f "$$KUBECONFIG_PATH" ]; then \
	  echo "ERROR: $$KUBECONFIG_PATH not found. Run 'make cluster NAME=$(CLUSTER)' first."; \
	  exit 1; \
	fi; \
	export KUBECONFIG="$$PWD/$$KUBECONFIG_PATH"; \
	echo "==> Resolving licenseId for customer $(CUSTOMER)"; \
	LICENSE_ID=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$(CUSTOMER)" '.[] | select(.archivedAt == null) | select(.name == $$n) | .installationId // empty'); \
	if [ -z "$$LICENSE_ID" ] || [ "$$LICENSE_ID" = "null" ]; then \
	  echo "ERROR: customer $(CUSTOMER) not found. Run 'make customer NAME=$(CUSTOMER)' first."; \
	  exit 1; \
	fi; \
	echo "==> Pre-installing CNPG + cert-manager (idempotent)"; \
	helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true; \
	helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true; \
	helm repo update >/dev/null; \
	helm upgrade --install cnpg-operator cnpg/cloudnative-pg \
	  --namespace cnpg-system --create-namespace --wait --timeout 3m; \
	helm upgrade --install cert-manager jetstack/cert-manager \
	  --namespace cert-manager --create-namespace \
	  --set crds.enabled=true --wait --timeout 3m; \
	echo "==> helm registry login registry.replicated.com"; \
	echo "$$LICENSE_ID" | helm registry login registry.replicated.com \
	  --username "$$LICENSE_ID" --password-stdin; \
	OCI_URL="oci://registry.replicated.com/$(APP_SLUG)/$(call lower,$(CHANNEL))/$(APP_SLUG)"; \
	echo "==> Installing $(APP_SLUG) $(CHART_VER) into ns $(NAMESPACE)"; \
	echo "    OCI: $$OCI_URL"; \
	helm upgrade --install $(APP_SLUG) "$$OCI_URL" \
	  --version "$(CHART_VER)" \
	  --namespace "$(NAMESPACE)" --create-namespace \
	  --set cloudnative-pg.enabled=false \
	  --set cert-manager.enabled=false \
	  --wait --timeout 5m; \
	echo "OK: deploy complete."; \
	echo ""; \
	echo "Pods:"; \
	kubectl get pods -n "$(NAMESPACE)"

# Lower-case helper for OCI URL channel slug (Replicated uses lowercase channel slugs).
lower = $(shell echo "$(1)" | tr '[:upper:]' '[:lower:]')

# ---------- expose --------------------------------------------------------
#
# Provision a public ingress URL on a CMX cluster and wire the frontend
# service to it. Replicated CMX issues a hostname under
# *.ingress.replicatedcluster.com plus a Let's Encrypt cert.
#
# Required: CLUSTER=<cluster-name>. Optional: PORT=<nodePort> (default 30080),
# NAMESPACE=<ns> (default groovelab), SVC=<svc> (default groovelab-frontend),
# SVC_PORT=<port> (default 443; the service port that backs the NodePort).
#
# Caveats:
#   - Only works on VM-based distributions (rke2, embedded-cluster, kind);
#     k3s and similar container distributions are rejected by CMX.
#   - The hostname is auto-generated and changes when re-exposed.

expose: _require-token _require-cluster ## Expose CLUSTER's frontend on a public Replicated ingress URL (rke2/EC only; idempotent)
	@set -euo pipefail; \
	PORT="$${PORT:-30080}"; \
	NAMESPACE="$${NAMESPACE:-$(APP_SLUG)}"; \
	SVC="$${SVC:-$(APP_SLUG)-frontend}"; \
	KUBECONFIG_PATH="$(DIST_DIR)/$(CLUSTER)-kubeconfig.yaml"; \
	if [ ! -f "$$KUBECONFIG_PATH" ]; then \
	  echo "ERROR: $$KUBECONFIG_PATH not found. Run 'make cluster NAME=$(CLUSTER)' first." >&2; \
	  exit 1; \
	fi; \
	export KUBECONFIG="$$PWD/$$KUBECONFIG_PATH"; \
	echo "==> Resolving cluster ID for $(CLUSTER)"; \
	CID=$$(replicated cluster ls --output json \
	  | jq -r --arg n "$(CLUSTER)" '[.[] | select(.name == $$n and .status == "running")][0].id // empty'); \
	if [ -z "$$CID" ]; then \
	  echo "ERROR: cluster $(CLUSTER) not found or not running." >&2; \
	  exit 1; \
	fi; \
	EXISTING=$$(replicated cluster port ls "$$CID" --output json --app "$(APP_SLUG)" 2>/dev/null \
	  | jq -r --arg p "$$PORT" 'map(select(.upstream_port == ($$p | tonumber) and .state == "ready")) | .[0] // empty | .hostname // ""'); \
	if [ -n "$$EXISTING" ]; then \
	  echo "==> Port $$PORT already exposed at $$EXISTING — reusing (idempotent)."; \
	  echo "==> Ensuring $$NAMESPACE/$$SVC is NodePort:$$PORT"; \
	  CUR_TYPE=$$(kubectl get svc "$$SVC" -n "$$NAMESPACE" -o jsonpath='{.spec.type}' 2>/dev/null || echo ""); \
	  CUR_NP=$$(kubectl get svc "$$SVC" -n "$$NAMESPACE" -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo ""); \
	  if [ "$$CUR_TYPE" != "NodePort" ] || [ "$$CUR_NP" != "$$PORT" ]; then \
	    kubectl patch svc "$$SVC" -n "$$NAMESPACE" --type='json' \
	      -p='[{"op":"replace","path":"/spec/type","value":"NodePort"},{"op":"add","path":"/spec/ports/0/nodePort","value":'$$PORT'}]'; \
	  else \
	    echo "    (already NodePort:$$PORT, no change)"; \
	  fi; \
	  echo ""; \
	  echo "OK: $(APP_SLUG) is reachable at: https://$$EXISTING"; \
	else \
	  echo "==> Patching $$NAMESPACE/$$SVC to NodePort:$$PORT"; \
	  kubectl patch svc "$$SVC" -n "$$NAMESPACE" --type='json' \
	    -p='[{"op":"replace","path":"/spec/type","value":"NodePort"},{"op":"add","path":"/spec/ports/0/nodePort","value":'$$PORT'}]'; \
	  echo "==> replicated cluster port expose $$CID --port $$PORT --protocol https"; \
	  replicated cluster port expose "$$CID" --port "$$PORT" --protocol https --app "$(APP_SLUG)"; \
	  URL=$$(replicated cluster port ls "$$CID" --output json --app "$(APP_SLUG)" \
	    | jq -r --arg p "$$PORT" 'map(select(.upstream_port == ($$p | tonumber))) | sort_by(.created_at) | reverse | .[0].hostname // ""'); \
	  echo ""; \
	  echo "OK: $(APP_SLUG) is reachable at: https://$$URL"; \
	fi

# ---------- smoke ----------------------------------------------------------

smoke: _require-cluster ## Run smoke checks against an installed NAMESPACE on CLUSTER
	@set -euo pipefail; \
	KUBECONFIG_PATH="$(DIST_DIR)/$(CLUSTER)-kubeconfig.yaml"; \
	if [ ! -f "$$KUBECONFIG_PATH" ]; then \
	  echo "ERROR: $$KUBECONFIG_PATH not found."; \
	  exit 1; \
	fi; \
	export KUBECONFIG="$$PWD/$$KUBECONFIG_PATH"; \
	echo "==> Port-forwarding $(APP_SLUG)-backend in $(NAMESPACE)"; \
	kubectl port-forward -n "$(NAMESPACE)" svc/$(APP_SLUG)-backend 18080:8080 >/dev/null 2>&1 & \
	PF_PID=$$!; \
	sleep 5; \
	trap 'kill $$PF_PID 2>/dev/null || true' EXIT; \
	echo "==> /healthz"; \
	HEALTH_HTTP=$$(curl -s -o /tmp/healthz.json -w "%{http_code}" http://localhost:18080/healthz); \
	if [ "$$HEALTH_HTTP" != "200" ]; then \
	  echo "FAIL: /healthz returned HTTP $$HEALTH_HTTP"; \
	  cat /tmp/healthz.json; exit 1; \
	fi; \
	jq '{version, status, db: .checks.database.status, redis: .checks.redis.status, license: .checks.license.status}' /tmp/healthz.json; \
	echo "==> /api/replicated/updates (cold cache should be 200 pending)"; \
	UPDATES_HTTP=$$(curl -s -o /tmp/updates.json -w "%{http_code}" http://localhost:18080/api/replicated/updates); \
	if [ "$$UPDATES_HTTP" != "200" ]; then \
	  echo "FAIL: /api/replicated/updates returned HTTP $$UPDATES_HTTP (want 200)"; \
	  cat /tmp/updates.json; exit 1; \
	fi; \
	jq . /tmp/updates.json; \
	echo "==> /api/v1/flashcards/answer with no body (404 contract)"; \
	ANS_HTTP=$$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' \
	  -d '{}' http://localhost:18080/api/v1/flashcards/answer); \
	if [ "$$ANS_HTTP" != "404" ]; then \
	  echo "FAIL: /flashcards/answer returned HTTP $$ANS_HTTP (want 404)"; exit 1; \
	fi; \
	echo "OK: smoke checks green ($(APP_SLUG) on $(CLUSTER)/$(NAMESPACE))"

# ---------- uat (composite) ------------------------------------------------

uat: _require-token _require-version ## Composite: ensure customer + cluster, deploy VERSION, run smoke. Auto-derives names.
	@set -euo pipefail; \
	UAT_NAME="uat-v$(CHART_VER)"; \
	UAT_CLUSTER=$$(echo "uat-v$(CHART_VER)" | tr '.' '-'); \
	echo "==> UAT for v$(CHART_VER) (customer=$$UAT_NAME cluster=$$UAT_CLUSTER channel=$(CHANNEL))"; \
	$(MAKE) customer NAME="$$UAT_NAME" CHANNEL=$(CHANNEL); \
	$(MAKE) cluster NAME="$$UAT_CLUSTER"; \
	$(MAKE) deploy VERSION=$(CHART_VER) CUSTOMER="$$UAT_NAME" CLUSTER="$$UAT_CLUSTER" CHANNEL=$(CHANNEL); \
	$(MAKE) smoke CLUSTER="$$UAT_CLUSTER" NAMESPACE=$(NAMESPACE); \
	echo ""; \
	echo "PASS: UAT green for v$(CHART_VER)."; \
	echo "Teardown:  make teardown CUSTOMER=$$UAT_NAME CLUSTER=$$UAT_CLUSTER"

# ---------- teardown -------------------------------------------------------

teardown: _require-token ## Archive customer, delete cluster (preserves test artifacts elsewhere)
	@set -euo pipefail; \
	if [ -z "$${CUSTOMER:-}" ] && [ -z "$${CLUSTER:-}" ]; then \
	  echo "ERROR: at least one of CUSTOMER=<name> or CLUSTER=<name> required."; exit 2; \
	fi; \
	if [ -n "$${CUSTOMER:-}" ]; then \
	  CUST_ID=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	    | jq -r --arg n "$(CUSTOMER)" '.[] | select(.name == $$n) | .id // empty'); \
	  if [ -n "$$CUST_ID" ]; then \
	    echo "==> Archiving customer $(CUSTOMER) ($$CUST_ID)"; \
	    replicated customer archive "$$CUST_ID" --app "$(APP_SLUG)" || true; \
	  else \
	    echo "==> Customer $(CUSTOMER) already gone"; \
	  fi; \
	fi; \
	if [ -n "$${CLUSTER:-}" ]; then \
	  CLUSTER_ID=$$(replicated cluster ls --output json \
	    | jq -r --arg n "$(CLUSTER)" '[.[] | select(.name == $$n)][0].id // empty'); \
	  if [ -n "$$CLUSTER_ID" ]; then \
	    echo "==> Deleting cluster $(CLUSTER) ($$CLUSTER_ID)"; \
	    replicated cluster rm "$$CLUSTER_ID" --app "$(APP_SLUG)" || true; \
	  else \
	    echo "==> Cluster $(CLUSTER) already gone"; \
	  fi; \
	  rm -f $(DIST_DIR)/$(CLUSTER)-kubeconfig.yaml; \
	fi; \
	echo "OK: teardown complete."

# ---------- guards ---------------------------------------------------------

_require-version-tag:
	@if [ -z "$${VERSION:-}" ]; then \
	  echo "ERROR: VERSION=vX.Y.Z is required."; exit 2; \
	fi; \
	if ! echo "$(VERSION)" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$$'; then \
	  echo "ERROR: VERSION must be a SemVer tag starting with 'v' (e.g. v0.1.3, v0.0.0-test.1)."; \
	  echo "       Got: $(VERSION)"; exit 2; \
	fi; \
	if echo "$(VERSION)" | grep -qE '^v9+\.9+\.9+$$|^v99+\.99+\.99+$$'; then \
	  echo "ERROR: $(VERSION) is reserved-style nines. Use a pre-release qualifier (v0.0.0-test.<sha>)."; \
	  echo "       Plain SemVer-max numerals poison OCI 'latest' resolution forever (FRICTION_LOG.md Entry 34)."; \
	  exit 2; \
	fi

_require-customer:
	@if [ -z "$${CUSTOMER:-}" ]; then \
	  echo "ERROR: CUSTOMER=<customer-name> is required."; exit 2; \
	fi

_require-cluster:
	@if [ -z "$${CLUSTER:-}" ]; then \
	  echo "ERROR: CLUSTER=<cluster-name> is required."; exit 2; \
	fi
