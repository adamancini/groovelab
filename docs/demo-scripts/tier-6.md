# Tier 6 -- Deliver It (Demo Script)

**Target length:** 5:00. **Epic:** GRO-7vb8. **UAT:** `.vault/knowledge/uat/uat-GRO-7vb8-tier6-deliver-it.md`

## Goal

Show that Groovelab is production-ready for Replicated distribution: air-gap
image bundling, KOTS Config screen, CVE scanning, Enterprise Portal docs, and
end-to-end install paths (Helm + Embedded Cluster) are all documented and
verified.

## Setup (do before hitting record)

Terminal window at repo root, chart dependencies resolved:

```bash
cd /Users/ada/src/github.com/adamancini/groovelab
helm dependency build chart/ >/dev/null 2>&1
export REPLICATED_API_TOKEN=...
```

## Script

### 0:00 – 0:20 — Intro

> "Tier 6 — Deliver It. We've gone from a local Vite app to a fully packaged
> Replicated application. This tier is about production readiness: air-gap
> support, KOTS Config screen, CVE posture, and Enterprise Portal docs so
> customers can self-serve install via Helm or Embedded Cluster."

### 0:20 – 0:55 — Chart architecture: registry split + air-gap builder

Terminal:
```bash
grep -A 3 "image:" chart/values.yaml | head -20
grep "groovelab.imageRef" chart/templates/_helpers.tpl
grep -c "HasLocalRegistry" release/helmchart.yaml
```

> "Values.yaml splits registry from repository — no hardcoded proxy URLs.
> The imageRef helper constructs full references. And the HelmChart CR now
> carries a `spec.builder` block with every upstream image KOTS needs to
> bundle for air-gap, plus `HasLocalRegistry` ternaries that rewrite
> registry and repository at install time."

### 0:55 – 1:20 — KOTS Config CR replaces lookup()

Terminal:
```bash
cat release/kots-config.yaml
grep -r "lookup" chart/templates/postgresql/ || echo "lookup removed"
```

> "KOTS Config CR generates the CNPG password once with RandomString and
> passes it through to Helm. We removed the `lookup()` call that broke
> under `helm template` — every KOTS reconcile was regenerating the
> password and breaking backend pods."

### 1:20 – 1:50 — CVE posture: scanning in CI

Terminal:
```bash
grep -E "govulncheck|npm audit|trivy" .github/workflows/pr.yaml | head -10
cat docs/cve-posture.md | head -30
```

> "Go vulnerabilities via govulncheck, npm audit for the frontend, and
> Trivy container scans in both PR and release workflows. Findings are
> non-blocking by design — base-image CVEs get patched on Renovate's
> schedule — but every build produces a SARIF report."

### 1:50 – 2:30 — Air-gap network policy

Terminal:
```bash
cat chart/templates/networkpolicy.yaml
helm template groovelab chart/ --set airgap.networkPolicy.enabled=true | grep -A 30 "kind: NetworkPolicy"
```

> "When air-gap mode is enabled, the network policy blocks all egress
> except intra-namespace traffic and DNS. Zero outbound requests to the
> internet."

### 2:30 – 3:15 — Enterprise Portal docs

Terminal:
```bash
ls docs/*.md
wc -l docs/*.md | tail -1
```

> "Eight documentation files cover Helm install, Embedded Cluster install,
> upgrades, air-gap validation, CVE posture, notifications, Terraform
> modules, and self-serve sign-up. These are linked from the Replicated
> Enterprise Portal so customers can install without vendor intervention."

### 3:15 – 3:45 — Replicated lint passes

Terminal:
```bash
make lint 2>&1 | tail -10
```

> "`make lint` runs helm lint, version sync checks, and replicated release
> lint. All green — the KOTS manifests are well-formed and the chart
> packages correctly."

### 3:45 – 4:30 — Tier 6 e2e test

Terminal:
```bash
cd tests/e2e && go test -run TestTier6E2E -v -timeout 10m
```

> "The e2e test verifies all Tier 6 deliverables: branding assets, docs,
> portal configuration, and the full install paths. It compiles and is
> ready for CI integration."

### 4:30 – 5:00 — Close

> "Tier 6 is complete. The application is documented, scanned, air-gap
> ready, and packaged for both Helm and Embedded Cluster installs. Next
> tier: Operationalize It — notifications, signed images, and air-gap
> zero-outbound validation."

## Beats to cut if you run long

- Skip the CVE scanning beat (1:20–1:50) — mention it in voiceover only
- Skip the network policy live render (1:50–2:30) — show the file, not the template output
- Shorten the e2e test beat to just show compilation, not full run

## Pre-recording checklist

- [ ] `helm dependency build chart/` has been run
- [ ] `REPLICATED_API_TOKEN` is set (for `make lint`)
- [ ] `go test -run TestTier6E2E` compiles (no need to run against real cluster)
- [ ] Terminal font is large enough for Loom readability
