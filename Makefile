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

.PHONY: help chart-deps chart-package chart-lint release-unstable clean-dist _require-version _require-token

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m [VAR=value ...]\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Conventions:"
	@echo "  - Pass env vars AFTER the command, e.g. make release-unstable VERSION=v0.1.1"
	@echo "  - REPLICATED_API_TOKEN must be exported for release-unstable (use .envrc or your shell)"

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
