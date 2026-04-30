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
        chart-test-overrides chart-test-config-mapping \
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

chart-test-overrides: chart-deps ## Regression: verify --set overrides for guestAccess/sessionDuration/maxCardsPerSession render through (no `| default` footgun). See GRO-7uiw.
	@echo "[chart-test-overrides] auth.guestAccess=false ..."
	@helm template $(CHART_DIR) --set auth.guestAccess=false 2>/dev/null | grep -A1 'GUEST_ACCESS_ENABLED' | grep -q '"false"' || { echo "FAIL: auth.guestAccess=false did not render '\"false\"'"; exit 1; }
	@echo "[chart-test-overrides] auth.sessionDuration=1h ..."
	@helm template $(CHART_DIR) --set auth.sessionDuration=1h 2>/dev/null | grep -A1 'SESSION_DURATION' | grep -q '"1h"' || { echo "FAIL: auth.sessionDuration=1h did not render '\"1h\"'"; exit 1; }
	@echo "[chart-test-overrides] flashcards.maxCardsPerSession=5 ..."
	@helm template $(CHART_DIR) --set flashcards.maxCardsPerSession=5 2>/dev/null | grep -A1 'MAX_CARDS_PER_SESSION' | grep -q '"5"' || { echo "FAIL: flashcards.maxCardsPerSession=5 did not render '\"5\"'"; exit 1; }
	@echo "OK: all three operator overrides render through to backend Deployment env."

chart-test-config-mapping: chart-deps ## Tier 5: verify release/config.yaml -> release/helmchart.yaml -> chart values mapping integrity (Layer 1 e2e). See GRO-hznr.
	@echo "[chart-test-config-mapping] release/config.yaml present and well-formed ..."
	@test -f release/config.yaml || { echo "FAIL: release/config.yaml missing"; exit 1; }
	@yq -e '.kind == "Config"' release/config.yaml >/dev/null || { echo "FAIL: release/config.yaml is not kind: Config"; exit 1; }
	@echo "[chart-test-config-mapping] session_duration regex pattern ^\\d+[hm]\$$ ..."
	@yq -e '.spec.groups[] | select(.name=="app") | .items[] | select(.name=="session_duration") | .validation.regex.pattern == "^\\d+[hm]$$"' release/config.yaml >/dev/null \
		|| { echo "FAIL: session_duration regex pattern missing or wrong in release/config.yaml"; exit 1; }
	@echo "[chart-test-config-mapping] max_cards_per_session regex pattern ^\\d+\$$ ..."
	@yq -e '.spec.groups[] | select(.name=="app") | .items[] | select(.name=="max_cards_per_session") | .validation.regex.pattern == "^\\d+$$"' release/config.yaml >/dev/null \
		|| { echo "FAIL: max_cards_per_session regex pattern missing or wrong in release/config.yaml"; exit 1; }
	@echo "[chart-test-config-mapping] external_db_password uses RandomString 24 (generated default that survives upgrade) ..."
	@yq -e '.spec.groups[] | select(.name=="database") | .items[] | select(.name=="external_db_password") | .default == "{{repl RandomString 24}}"' release/config.yaml >/dev/null \
		|| { echo "FAIL: external_db_password default is not '{{repl RandomString 24}}' in release/config.yaml"; exit 1; }
	@echo "[chart-test-config-mapping] release/helmchart.yaml maps session_duration -> auth.sessionDuration ..."
	@yq -e '.spec.values.auth.sessionDuration == "{{repl ConfigOption \"session_duration\"}}"' release/helmchart.yaml >/dev/null \
		|| { echo "FAIL: helmchart.yaml does not map session_duration to auth.sessionDuration"; exit 1; }
	@echo "[chart-test-config-mapping] release/helmchart.yaml maps guest_access -> auth.guestAccess (bool via ConfigOptionEquals) ..."
	@yq -e '.spec.values.auth.guestAccess == "{{repl ConfigOptionEquals \"guest_access\" \"1\"}}"' release/helmchart.yaml >/dev/null \
		|| { echo "FAIL: helmchart.yaml does not map guest_access to auth.guestAccess"; exit 1; }
	@echo "[chart-test-config-mapping] release/helmchart.yaml maps max_cards_per_session -> flashcards.maxCardsPerSession ..."
	@yq -e '.spec.values.flashcards.maxCardsPerSession == "{{repl ConfigOption \"max_cards_per_session\"}}"' release/helmchart.yaml >/dev/null \
		|| { echo "FAIL: helmchart.yaml does not map max_cards_per_session to flashcards.maxCardsPerSession"; exit 1; }
	@echo "[chart-test-config-mapping] external-DB optionalValues block is gated on db_type=external ..."
	@yq -e '[.spec.optionalValues[] | select(.when == "{{repl ConfigOptionEquals \"db_type\" \"external\"}}")] | length == 1' release/helmchart.yaml >/dev/null \
		|| { echo "FAIL: helmchart.yaml lacks an optionalValues entry gated on db_type=external"; exit 1; }
	@echo "[chart-test-config-mapping] external-DB optionalValues maps cnpg.createCluster=false + externalDatabase.password ..."
	@yq -e '.spec.optionalValues[] | select(.when == "{{repl ConfigOptionEquals \"db_type\" \"external\"}}") | .values.cnpg.createCluster == false' release/helmchart.yaml >/dev/null \
		|| { echo "FAIL: external-DB optionalValues does not set cnpg.createCluster: false"; exit 1; }
	@yq -e '.spec.optionalValues[] | select(.when == "{{repl ConfigOptionEquals \"db_type\" \"external\"}}") | .values.externalDatabase.password == "{{repl ConfigOption \"external_db_password\"}}"' release/helmchart.yaml >/dev/null \
		|| { echo "FAIL: external-DB optionalValues does not pass external_db_password through to externalDatabase.password"; exit 1; }
	@echo "[chart-test-config-mapping] cnpg.createCluster=false skips the postgresql.cnpg.io/v1 Cluster manifest ..."
	@if helm template $(CHART_DIR) --set cnpg.createCluster=true 2>/dev/null | grep -q '^kind: Cluster$$'; then \
		echo "  cnpg.createCluster=true does emit a Cluster manifest (baseline OK)"; \
	else \
		echo "FAIL: baseline cnpg.createCluster=true did not emit a Cluster manifest -- chart shape changed"; exit 1; \
	fi
	@if helm template $(CHART_DIR) --set cnpg.createCluster=false 2>/dev/null | grep -q '^kind: Cluster$$'; then \
		echo "FAIL: cnpg.createCluster=false still emitted a postgresql.cnpg.io Cluster manifest"; exit 1; \
	else \
		echo "  cnpg.createCluster=false correctly skips the Cluster manifest"; \
	fi
	@echo "[chart-test-config-mapping] external-DB --set overrides flow into rendered preflight collectors ..."
	@helm template $(CHART_DIR) \
		--set cloudnative-pg.enabled=false \
		--set cnpg.createCluster=false \
		--set externalDatabase.host=db.example.com \
		--set externalDatabase.port=5433 \
		--set externalDatabase.username=ext_user \
		2>/dev/null | grep -q 'db.example.com' \
		|| { echo "FAIL: externalDatabase.host=db.example.com did not flow into rendered preflight manifests"; exit 1; }
	@echo "OK: config.yaml -> helmchart.yaml -> chart values mapping is intact and renders through."

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
#   pr-customer  — create or reuse trial customer licensed to the channel
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

pr-customer: _require-token pr-channel ## Create or reuse the trial customer licensed to the per-PR channel
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	NAME="$(PR_CUSTOMER_NAME)"; \
	echo "==> Customer for slug: $$SLUG (name: $$NAME)"; \
	EXISTING=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	  | jq -r --arg n "$$NAME" '.[] | select(.name == $$n) | .installationId // empty'); \
	if [ -n "$$EXISTING" ]; then \
	  echo "OK: reusing customer $$NAME"; \
	else \
	  CUSTOMER_JSON=$$(replicated customer create \
	    --name "$$NAME" --email "pr+$$SLUG@replicated.com" \
	    --channel "$$SLUG" --type trial --expires-in 24h \
	    --app "$(APP_SLUG)" --output json); \
	  LICENSE_ID=$$(echo "$$CUSTOMER_JSON" \
	    | jq -r --arg n "$$NAME" 'if type == "array" then (.[] | select(.name == $$n) | .installationId // empty) else (.installationId // .customer.installationId // empty) end' \
	    | head -n1); \
	  if [ -z "$$LICENSE_ID" ] || [ "$$LICENSE_ID" = "null" ]; then \
	    LICENSE_ID=$$(replicated customer ls --app "$(APP_SLUG)" --output json \
	      | jq -r --arg n "$$NAME" '.[] | select(.name == $$n) | .installationId'); \
	  fi; \
	  echo "OK: customer $$NAME created"; \
	fi

pr-cluster: _require-token _require-not-main ## Provision a CMX k3s cluster (1h TTL, scoped to slug)
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	CLUSTER_NAME="pr-$$SLUG-$$(date +%s)"; \
	CLUSTER_NAME="$${CLUSTER_NAME:0:63}"; \
	echo "==> Provisioning CMX k3s cluster $$CLUSTER_NAME (TTL 1h)"; \
	CLUSTER_JSON=$$(replicated cluster create \
	  --distribution k3s --version "1.32" \
	  --name "$$CLUSTER_NAME" --ttl 1h --wait 10m \
	  --app "$(APP_SLUG)" --output json); \
	CLUSTER_ID=$$(echo "$$CLUSTER_JSON" \
	  | jq -r --arg n "$$CLUSTER_NAME" 'if type == "array" then (.[] | select(.name == $$n) | .id // empty) else (.id // .cluster.id // empty) end' \
	  | head -n1); \
	echo "OK: cluster $$CLUSTER_NAME (ID: $$CLUSTER_ID)"; \
	mkdir -p $(DIST_DIR); \
	echo "$$CLUSTER_ID" > $(DIST_DIR)/pr-cluster-id; \
	echo "$$CLUSTER_NAME" > $(DIST_DIR)/pr-cluster-name; \
	replicated cluster kubeconfig "$$CLUSTER_ID" --app "$(APP_SLUG)" \
	  --output-path $(DIST_DIR)/pr-kubeconfig.yaml; \
	echo "OK: kubeconfig written to $(DIST_DIR)/pr-kubeconfig.yaml"; \
	echo ""; \
	echo "Use:  export KUBECONFIG=$$PWD/$(DIST_DIR)/pr-kubeconfig.yaml"

pr-install: _require-token _require-not-main pr-channel pr-customer ## Package chart, release on per-PR channel, helm install via OCI (assumes pr-cluster ran)
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	CHART_VERSION="$(PR_CHART_VERSION)"; \
	NAME="$(PR_CUSTOMER_NAME)"; \
	if [ ! -f $(DIST_DIR)/pr-kubeconfig.yaml ]; then \
	  echo "ERROR: $(DIST_DIR)/pr-kubeconfig.yaml not found. Run 'make pr-cluster' first."; \
	  exit 1; \
	fi; \
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
	echo "==> Pre-installing CNPG operator (CRDs first)"; \
	(cd $(CHART_DIR)/charts && for f in cloudnative-pg-*.tgz; do \
	   [ -f "$$f" ] && [ ! -d "$${f%.tgz}" ] && tar xzf "$$f" || true; \
	 done); \
	helm upgrade --install cnpg-operator $(CHART_DIR)/charts/cloudnative-pg \
	  --namespace cnpg-system --create-namespace --wait --timeout 3m; \
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
	echo "==> helm install $(APP_SLUG) $$OCI_URL --version $$CHART_VERSION"; \
	helm install "$(APP_SLUG)" "$$OCI_URL" \
	  --version "$$CHART_VERSION" \
	  --namespace "$(APP_SLUG)" --create-namespace \
	  --set cloudnative-pg.enabled=false; \
	echo ""; \
	echo "==> Waiting for pods to be ready (5m deadline)"; \
	DEADLINE=$$(($$(date +%s) + 300)); \
	while true; do \
	  echo "[$$(date +%H:%M:%S)] Pod status:"; \
	  kubectl get pods -n "$(APP_SLUG)" --no-headers 2>/dev/null || true; \
	  NOT_READY=$$(kubectl get pods -n "$(APP_SLUG)" --no-headers 2>/dev/null | grep -v -E "Running|Completed" || true); \
	  [ -z "$$NOT_READY" ] && break; \
	  if [ "$$(date +%s)" -ge "$$DEADLINE" ]; then \
	    echo "TIMEOUT: pods not ready after 5 minutes"; \
	    kubectl get events -n "$(APP_SLUG)" --sort-by=.lastTimestamp | tail -30; \
	    exit 1; \
	  fi; \
	  sleep 15; \
	done; \
	echo "OK: all pods running."; \
	echo "==> Smoke test: /healthz 200 + flashcards/answer 404"; \
	kubectl port-forward svc/$(APP_SLUG)-backend 18080:8080 -n "$(APP_SLUG)" >/dev/null 2>&1 & \
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

pr-teardown: _require-token ## Tear down per-PR channel, customer, and cluster
	@set -euo pipefail; \
	SLUG="$(PR_SLUG)"; \
	NAME="$(PR_CUSTOMER_NAME)"; \
	echo "==> Tearing down resources for slug: $$SLUG"; \
	if [ -f $(DIST_DIR)/pr-cluster-id ]; then \
	  CID=$$(cat $(DIST_DIR)/pr-cluster-id); \
	  if [ -n "$$CID" ]; then \
	    echo "  - Removing cluster $$CID"; \
	    replicated cluster rm "$$CID" --app "$(APP_SLUG)" || true; \
	  fi; \
	  rm -f $(DIST_DIR)/pr-cluster-id $(DIST_DIR)/pr-cluster-name $(DIST_DIR)/pr-kubeconfig.yaml; \
	else \
	  echo "  - No cluster id file at $(DIST_DIR)/pr-cluster-id (skip cluster rm; 1h TTL covers it)"; \
	fi; \
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
	echo "OK: teardown complete."
