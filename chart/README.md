# Groovelab Helm Chart

Browser-based music theory learning and practice application for bassists.

## Version invariant

There is exactly one source of truth for the image tag deployed by this chart:
`Chart.yaml.appVersion`. Templates resolve image references via
`{{ .Values.image.<side>.tag | default .Chart.AppVersion }}`, so leaving
`image.frontend.tag` and `image.backend.tag` empty in `values.yaml` causes the
chart to pull the image whose tag equals `.Chart.AppVersion`.

Conventions:

- `Chart.yaml.version` is pure [SemVer](https://semver.org/) (e.g. `0.1.0`),
  bumped by CI to `${GITHUB_REF_NAME#v}` at release time. Helm rejects chart
  versions with a leading `v`.
- `Chart.yaml.appVersion` carries the `v` prefix (e.g. `v0.1.0`). This value
  matches the GHCR image tag that CI pushed for the release, which is
  `${GITHUB_REF_NAME}` verbatim (e.g. tag `v0.1.0` produces
  `ghcr.io/adamancini/groovelab-{frontend,backend}:v0.1.0`).
- `values.yaml` leaves `image.frontend.tag` and `image.backend.tag` as empty
  strings (`""`). Templates fall back to `.Chart.AppVersion`.
- Local developer overrides (`--set image.backend.tag=dev-abc123`) still work
  unchanged — explicit values win over the default.

### CI rewrite

The `release-unstable` job in `.github/workflows/release.yaml` rewrites
`chart/Chart.yaml` in-place before `replicated release create`:

```yaml
- name: Sync Chart.yaml version to tag
  env:
    VERSION: ${{ env.VERSION }}
  run: |
    CHART_VERSION="${VERSION#v}"
    APP_VERSION="${VERSION}"
    yq -i ".version = \"${CHART_VERSION}\"" chart/Chart.yaml
    yq -i ".appVersion = \"${APP_VERSION}\"" chart/Chart.yaml
```

This keeps the chart checked into git in a runnable state (local
`helm template chart/` renders a valid deployment pointing at the last
shipped image) while guaranteeing CI-produced releases match the tag.

### release/helmchart.yaml also carries chartVersion

The KOTS `HelmChart` CR at `release/helmchart.yaml` has a
`.spec.chart.chartVersion` field that must match `chart/Chart.yaml.version`.
If it drifts, KOTS cannot resolve the chart inside the downloaded release.

CI rewrites this file too, in the step right after Chart.yaml sync:

```yaml
- name: Sync release/helmchart.yaml chartVersion to tag
  env:
    VERSION: ${{ env.VERSION }}
  run: |
    CHART_VERSION="${VERSION#v}"
    yq -i ".spec.chart.chartVersion = \"${CHART_VERSION}\"" release/helmchart.yaml
```

The local `make release-unstable VERSION=vX.Y.Z` target performs the same
three-file rewrite (`chart/Chart.yaml.version`, `chart/Chart.yaml.appVersion`,
`release/helmchart.yaml.spec.chart.chartVersion`) before packaging, so
developers cutting a release locally produce the same artifact shape as CI.

### Packaging path: `helm package` into `release/`, then `--yaml-dir release/`

Releases are created by:

1. `helm package chart/ --destination release/` — produces
   `release/groovelab-<version>.tgz` with all files preserved
   (`_helpers.tpl`, `NOTES.txt`, subchart tarballs).
2. `replicated release create --yaml-dir release/ --promote Unstable ...`
   — the `release/` directory now contains both the packaged chart
   tarball and the KOTS CRs (`application.yaml`, `helmchart.yaml`,
   `embedded-cluster-config.yaml`), which the Replicated CLI bundles
   into one release.

**Do not** use `replicated release create --yaml-dir chart/` — it filters
inputs to `.yaml`/`.yml`, silently dropping `_helpers.tpl` and `NOTES.txt`,
which makes every `{{ include "groovelab.fullname" . }}` call in the chart
fail at install time. See GRO-kydk and GRO-zkhp for context.

**Why not `--chart <tgz> --yaml-dir release/`?** The Replicated CLI
(tested with v0.124.5) treats those flags as mutually exclusive. Dropping
the tarball into `release/` and using a single `--yaml-dir` is the canonical
way to combine a packaged chart with KOTS manifests in one invocation.

The packaged `.tgz` that lands in `release/` is gitignored
(`release/*.tgz` in `.gitignore`) so local release runs do not pollute
the working tree.

### Never hand-edit Chart.yaml.version on main

Beyond bumping it to "what the next release will be", do not touch
`Chart.yaml.version` or `appVersion` on `main`. CI owns the rewrite.
Do NOT hardcode commit SHAs in `chart/values.yaml` — that reintroduces
drift between what was built, signed, and shipped.

## Local development

```bash
# Render the default manifests (pulls via proxy registry, tag = appVersion).
helm template chart/

# Render with local image overrides (typical Tilt / helmfile workflow).
helm template chart/ \
  --set image.backend.repository=ghcr.io/adamancini/groovelab-backend \
  --set image.backend.tag=dev-local

# Lint.
helm lint chart/
```

## cert-manager version pin rationale

`chart/Chart.yaml` pins the `cert-manager` subchart to `>=1.19.0,<1.20.0`
(the 1.19.x line). This is deliberate.

### Why cap at <1.20

- Customer clusters (and the dev/CMX environments we test against) run
  cert-manager 1.19.4.
- cert-manager 1.20 is a **breaking values-schema change**: the
  `networkPolicy.enabled` key moved from the top level to
  `webhook.networkPolicy.enabled`. Values that were valid against 1.19 are
  rejected by the 1.20 JSON schema, and the 1.20 `networkpolicy-cert-manager`
  template still references a path that the 1.20 defaults no longer populate,
  producing a nil-pointer render error partway through upgrade.
- A wide pin like `1.x.x` lets `helm dep update` float silently forward to
  1.20.x at release build time — the tarball we ship will refuse to upgrade a
  customer cluster still on 1.19.x. This actually happened on the `v0.1.0`
  release; see nd bug `GRO-k6de` and `GRO-a2b1` Phase B notes.

### What must change before we bump to 1.20+

Crossing the 1.19 → 1.20 boundary must be its own tested story, not an
implicit `helm dep update` side effect. The migration work:

1. Audit every cert-manager passthrough value under the `cert-manager:` key in
   `chart/values.yaml` against the 1.20 schema (`helm show values jetstack/cert-manager --version 1.20.x`).
2. If we ever set `networkPolicy.enabled` for cert-manager, move it under
   `webhook.networkPolicy.enabled`.
3. Dry-run `helm upgrade` on a 1.19.4 cluster with the 1.20.x-resolved chart and
   confirm render + schema validation both succeed.
4. Run a fresh `helm install` with the 1.20.x chart on a throwaway cluster and
   confirm cert-manager pods reach Ready and issuers still work.
5. Only then bump the pin to `>=1.20.0,<1.21.0` (or widen to `>=1.19.0,<1.21.0`
   with a compatibility test matrix), update this section, and regenerate the
   release.

Until that work is done, the chart resolves cert-manager to the 1.19.x line on
every release rebuild, and in-place upgrades on 1.19.x clusters keep working.

## Replicated-enabled by default

`chart/values.yaml` ships with `replicated.enabled: true` as the default, and
image repositories default to the Replicated proxy registry
(`proxy.xyyzx.net/proxy/adamancini/groovelab/...`). This is the invariant:

- **Default state** (every Replicated-managed install — KOTS, Embedded Cluster,
  customer Helm install via `oci://registry.replicated.com/library/...`):
  `replicated.enabled=true`. The Replicated SDK subchart installs, images pull
  from `proxy.xyyzx.net/proxy/...`, and the license-scoped pull secret
  `enterprise-pull-secret` (materialized from
  `global.replicated.dockerconfigjson`) is required for image pull. This is
  the customer-grade posture and the only path that exercises licensing,
  telemetry, preflights, and the full Replicated integration surface.

- **Local-dev override** (Tilt / helmfile loops against kind/minikube / bespoke
  developer clusters): use the `replicatedEnabled: false` profile in
  `helmfile.yaml.gotmpl`, or pass `--set replicated.enabled=false --set
  image.<side>.repository=ghcr.io/adamancini/groovelab-<side>` for a one-off
  `helm install`. This path skips the SDK subchart and pulls images directly
  from GHCR (no license required).

- **Never flip `replicated.enabled=false` as a default in `values.yaml`.** The
  default must stay `true` so every Replicated-managed install — and the
  customer-grade install-test in `.github/workflows/pr.yaml` — exercises the
  real production path.

### CI install-test carve-out

`.github/workflows/release.yaml`'s `release-unstable` job runs a smoke install
on an ephemeral CMX k3s cluster after every `v*` tag. That cluster is
unlicensed (it is not a customer install; it is a CI-internal smoke harness),
so it cannot pull from the Replicated proxy registry and the SDK subchart
cannot acquire its license secret. To keep CI green, the install and upgrade
steps in that workflow pass:

```
--set image.<side>.repository=ghcr.io/adamancini/groovelab-<side>  # direct GHCR pull
--set global.imagePullSecrets[0].name=ghcr-credentials             # GITHUB_TOKEN-backed
--set global.replicated.dockerconfigjson=null                      # suppress proxy pull secret
--set replicated.enabled=false                                     # skip SDK subchart
```

This is the explicit, documented exception. The **customer-grade** install
coverage — which exercises `replicated.enabled=true`, the proxy registry, and
the license-scoped pull secret end-to-end — lives in
`.github/workflows/pr.yaml` (see GRO-lcva). Do not mirror the
`replicated.enabled=false` overrides into any other install path without
adding a comparable inline comment justifying why.

### Why `global.replicated.dockerconfigjson` is not in `chart/values.yaml`

`chart/values.yaml` deliberately does **not** ship a default value for
`global.replicated.dockerconfigjson`. The Replicated SDK subchart uses
`hasKey` to decide whether to render the `enterprise-pull-secret` Secret
from this value, and `hasKey` returns true for an empty string. Shipping
`dockerconfigjson: ""` therefore renders an invalid Secret on any install
path that doesn't pull through Replicated's OCI registry:

```
Error: Secret "enterprise-pull-secret" is invalid:
data[.dockerconfigjson]: Invalid value: "": unexpected end of JSON input
```

(Surfaced by GRO-s3mc's CMX install test on a per-PR channel, where the
chart was packaged from raw source rather than pulled-and-injected by the
Replicated registry.)

Install paths that legitimately need the secret set it explicitly:

- **`oci://registry.replicated.com/...` pulls** — Replicated injects the
  real value at publish time before the chart reaches the cluster.
- **KOTS / Embedded Cluster** — KOTS sets it via the HelmChart CR's
  `values:` overrides after templating its own license metadata in.
- **Customer plain-Helm with proxy.xyyzx.net pulls** — the operator
  passes `--set global.replicated.dockerconfigjson=<base64>` themselves.

Everyone else (helmfile dev, bare CMX smoke installs, customer Helm
without proxy auth) intentionally has no key, and the SDK skips the
Secret. Our chart's own pull-secret list (`_helpers.tpl`'s
`groovelab.imagePullSecrets`) guards on truthiness, so an absent key
behaves correctly there too.

## KOTS manifests live in `release/`, not `chart/templates/`

KOTS custom resources (`kots.io/v1beta1 Application`, `kots.io/v1beta2 HelmChart`,
`kots.io/v1beta1 Config`, `embeddedcluster.replicated.com/v1beta1 Config`, etc.)
are **not Kubernetes CRDs** — they are never installed into the target cluster.
They are consumed only by the Replicated Vendor Portal at release-creation time
and by the KOTS Admin Console at install time. They must therefore live in
`release/`, which is the directory `replicated release create --yaml-dir` reads.

Putting them in `chart/templates/` breaks `helm install` on plain Kubernetes
(non-KOTS, non-EC) clusters — including the per-PR customer install test in
`.github/workflows/pr.yaml` — with `resource mapping not found for kind
"Application"` / `"HelmChart"` errors, because the kinds are unknown to the
target cluster's API server.

Current split:

| File                                         | Purpose                                | Lives in       |
|----------------------------------------------|----------------------------------------|----------------|
| `release/application.yaml`                   | KOTS Application CR                    | `release/`     |
| `release/helmchart.yaml`                     | KOTS HelmChart CR                      | `release/`     |
| `release/embedded-cluster-config.yaml`       | Embedded Cluster Config CR             | `release/`     |
| `chart/templates/preflight.yaml`             | Secret wrapping a `Preflight` spec     | `chart/`       |
| `chart/templates/support-bundle.yaml`        | Secret wrapping a `SupportBundle` spec | `chart/`       |

`chart/templates/preflight.yaml` and `chart/templates/support-bundle.yaml` are
legitimate chart templates: they render `kind: Secret` objects with the
`troubleshoot.sh/kind` label, which kotsadm and the `troubleshoot` CLI discover
at runtime. Those ARE cluster resources. This matches the pattern used in
`replicatedhq/platform-examples` (wg-easy, storagebox, onlineboutique, flipt).
The bare `troubleshoot.sh/v1beta2 Preflight` / `SupportBundle` manifests
(without the Secret wrapper) belong in `release/` — groovelab does not ship
those, only the in-cluster Secret-wrapped variants.

## CRD-check post-install hook

The chart renders `postgresql.cnpg.io/v1 Cluster` resources from the
CloudNativePG operator. Helm installs subchart CRDs in `charts/*/crds/`
before parent templates, but CNPG ships its CRDs as templates (not in
`crds/`), which means the parent `Cluster` CR can race the CRD's
Establishment under bare `helm install`. Symptom (from GRO-s3mc and
GRO-im3o):

```
resource mapping not found for name: "groovelab-postgresql"
no matches for kind "Cluster" in version "postgresql.cnpg.io/v1"
ensure CRDs are installed first
```

Two layers handle this:

### Layer 1 — Helmfile-driven install (CI + recommended customer install)

`helmfile.yaml.gotmpl` declares two ordered releases: `cnpg` (the CNPG
operator chart in its own namespace) and `groovelab` (this chart with
`cloudnative-pg.enabled=false` so the subchart isn't double-installed).
The `needs:` directive forces helmfile to install CNPG and wait for it
before installing groovelab. `.github/workflows/pr.yaml` invokes
`helmfile -e replicated apply` for the per-PR customer-grade install
test (GRO-lcva), exercising the same OCI URL a customer hits.

### Layer 2 — In-chart CRD-check Helm hook (belt and suspenders)

`chart/templates/crd-check-job.yaml` renders a `post-install`/
`post-upgrade` Job (with its own ServiceAccount + ClusterRole +
ClusterRoleBinding, all `helm.sh/hook` annotated and deleted on
success) that polls
`kubectl get crd <name> -o jsonpath='{.status.conditions[?(@.type=="Established")].status}'`
until each required CRD reports `True`, with a configurable timeout.
This makes the chart safe under ANY install path — bare `helm install`,
KOTS, Embedded Cluster — even without helmfile orchestration.

Pattern adapted from
[`replicatedhq/platform-examples` multi-chart-orchestration](https://github.com/replicatedhq/platform-examples/tree/main/patterns/multi-chart-orchestration),
which uses `bitnami/kubectl`. This chart cannot use Bitnami images
(see CLAUDE.md "Non-Negotiables") and uses
[`alpine/k8s`](https://hub.docker.com/r/alpine/k8s) instead — first-party
to the Alpine Linux organization, multi-arch, and ships kubectl alongside
a busybox shell. We considered `registry.k8s.io/kubectl` (the official
upstream image from the Kubernetes project) but that image is
distroless-style with no shell, which fails the Job's small polling loop
(`command: [/bin/sh, -c, ...]`). The polling loop logs progress per CRD
and applies a per-CRD timeout, which is harder to express as a single
`kubectl wait` invocation; alpine/k8s gives us the shell we need without
violating the Bitnami ban.

Configuration (`values.yaml`):

```yaml
crdCheck:
  enabled: true                       # disable for airgap / pre-established CRDs
  image:
    repository: alpine/k8s            # first-party (NOT bitnami); ships shell+kubectl
    tag: "1.32.3"
  crds:
    - clusters.postgresql.cnpg.io     # add subchart CRDs here as the chart grows
  timeout: 60                         # per-CRD wait timeout in seconds
```

The Job runs with `hook-weight: -5` (ServiceAccount/RBAC at `-10`) so
it executes ahead of any other post-install hooks that assume CRDs
exist. `before-hook-creation,hook-succeeded` hook-delete-policy
ensures clean re-installs.

### Installing on plain Helm (without helmfile or Replicated)

If you don't have helmfile available, install CNPG first then groovelab:

```bash
# 1. Install CNPG operator (CRDs reach Established before step 2).
helm install cloudnative-pg \
  oci://ghcr.io/cloudnative-pg/charts/cloudnative-pg \
  --namespace cnpg-system --create-namespace \
  --wait --timeout 5m

# 2. Install groovelab with the bundled CNPG subchart disabled.
helm install groovelab ./chart \
  --namespace groovelab --create-namespace \
  --set cloudnative-pg.enabled=false \
  --wait --timeout 6m
```

Replicated/KOTS and Embedded Cluster installs handle ordering
automatically via the KOTS HelmChart CR's `weight` field. The
in-chart CRD-check hook still runs on those paths and is a no-op when
CRDs are already Established.

## CI cluster lifecycle (medium-life shared cluster + per-PR namespace)

GRO-e4wb. As of this story, `.github/workflows/pr.yaml`'s `cmx-test` job no
longer provisions a fresh CMX cluster per run. Instead it shares a single
medium-life cluster across all PRs and isolates each PR at the Kubernetes
namespace layer:

| Resource | Lifetime | Scope |
|---|---|---|
| CMX cluster `groovelab-ci` | 24h TTL, lazily re-created | global (one per repo) |
| Cluster-shared infra (CNPG operator, cert-manager) | per-cluster | global on the cluster |
| Per-PR namespace `groovelab-pr-<slug>` | per-PR (until PR close) | per-PR |
| Per-PR Replicated channel `<slug>` | per-PR | per-PR |
| Per-PR dev customer `pr-<slug>` | per-PR (no expiration; archived on PR close) | per-PR |

Lookup-or-create flow (in pseudo-shell):

```bash
CLUSTER_ID=$(replicated cluster ls --output json \
  | jq -r '[.[] | select(.name == "groovelab-ci" and .status == "running")][0].id // empty')
if [ -z "$CLUSTER_ID" ]; then
  CLUSTER_ID=$(replicated cluster create \
    --distribution k3s --version 1.32 --ttl 24h \
    --name groovelab-ci --wait 5m --output json | jq -r '.id')
  NEED_INFRA_INSTALL=true   # install CNPG + cert-manager once on this fresh cluster
else
  NEED_INFRA_INSTALL=false  # reuse — operators already installed
fi

# When NEED_INFRA_INSTALL=true: pre-install BOTH CNPG and cert-manager into
# their own cluster-shared releases (`cnpg-operator` in `cnpg-system`,
# `cert-manager` in `cert-manager`). Their CRDs are cluster-scoped, so per-PR
# helm installs MUST disable the embedded subcharts (`--set
# cloudnative-pg.enabled=false --set cert-manager.enabled=false`); otherwise
# the second PR collides with Helm's CRD ownership annotations and fails
# with `meta.helm.sh/release-namespace must equal "<ns-2>": current value
# is "<ns-1>"`.
NAMESPACE="groovelab-pr-${SLUG}"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
helm install groovelab oci://... \
  --namespace "$NAMESPACE" --create-namespace \
  --set cloudnative-pg.enabled=false \
  --set cert-manager.enabled=false
```

PR close (`pr-cleanup.yaml`) removes only the namespace + customer + channel.
The cluster persists until its 24h CMX TTL fires; the next PR run after
eviction lazily provisions a new one.

Why: cluster provisioning was the largest unparallelizable contributor to
`cmx-test` wall-clock (~2-3 min). Sharing it means same-PR re-runs and
parallel PRs both pay $0 cluster time. Trade-off: the one PR run that
catches the eviction window pays the provisioning cost, and we accept that
in exchange for the steady-state savings.

`release.yaml` is intentionally unchanged — release-tag smoke tests still
provision short-lived ephemeral clusters since release frequency is low and
the additional isolation simplifies signed-release validation.

## Local per-PR install (`make pr-test`)

The repo-root `Makefile` has `pr-*` targets that mirror
`.github/workflows/pr.yaml`'s `cmx-test` job so you can reproduce a customer-
grade install from your laptop without push-and-wait. Slug normalization is
shared via `scripts/replicated-slug.sh` (sourced by both the Makefile and the
GitHub Actions workflows — single source of truth per GRO-m1bc).

```sh
# Print the normalized slug for the current branch (no side effects).
make pr-slug

# End-to-end (requires REPLICATED_API_TOKEN exported):
#   1. create or reuse the per-branch Replicated channel
#   2. create or reuse the dev customer licensed to that channel (no expiration)
#   3. lookup-or-create the shared `groovelab-ci` cluster (TTL 24h)
#   4. ensure namespace `groovelab-pr-<slug>` exists
#   5. pre-install CNPG operator + cert-manager (only if cluster was freshly provisioned)
#   6. package the chart, release it, helm install via OCI w/ license injection
#      (cloudnative-pg + cert-manager subcharts disabled — operators are cluster-shared)
#   7. run smoke tests (/healthz 200, /flashcards/answer 404)
make pr-test

# Pin the chart appVersion to a specific GHCR image tag while iterating.
make pr-test IMAGE_TAG=pr-123-abc1234

# Clean up per-PR resources (namespace + customer + channel). Shared cluster
# is NOT removed by `pr-teardown`; it persists per the GRO-e4wb lifecycle.
make pr-teardown
```

Guards: `pr-cluster` and `pr-install` refuse to run on `main`/`master`. All
`pr-*` targets that hit Replicated require `REPLICATED_API_TOKEN`. Env vars
go AFTER the command per the project convention (`make pr-test FOO=bar`,
not `FOO=bar make pr-test`).

## Image signature verification (cosign)

Both `groovelab-frontend` and `groovelab-backend` images published to
`ghcr.io/adamancini/` are keyless-signed via Cosign + GitHub Actions OIDC
during CI (`.github/workflows/pr.yaml` for per-PR images,
`.github/workflows/release.yaml` for tag-driven releases). The same workflow
that builds + pushes the image issues the signature, with the OIDC token
binding the signature to the workflow path and commit SHA. The CMX install
job in `pr.yaml` runs `cosign verify` against the GHCR images after pods are
Running (step "Verify image signatures (cosign keyless)") — this is the
same command a customer or downstream operator can run to independently
confirm provenance before pulling.

To verify a specific tag yourself (no public key needed — keyless verify
relies on the Sigstore transparency log + the OIDC certificate identity):

```bash
# Install cosign: https://docs.sigstore.dev/cosign/installation/
TAG="<the image tag to verify, e.g. v1.2.3 or pr-123-abc1234>"

for image in groovelab-frontend groovelab-backend; do
  cosign verify "ghcr.io/adamancini/${image}:${TAG}" \
    --certificate-identity-regexp='^https://github.com/adamancini/groovelab/.github/workflows/(pr|release)\.yaml@' \
    --certificate-oidc-issuer='https://token.actions.githubusercontent.com' \
    --output json \
    | jq -r '.[0].critical.identity."docker-reference"'
done
```

A successful verify prints the verified `docker-reference` (e.g.
`ghcr.io/adamancini/groovelab-frontend`) and exits 0. A signature
mismatch — wrong repo, wrong workflow path, untrusted issuer — exits non-zero
with a clear `no matching signatures` or `certificate identity` error.
Pin `--certificate-identity-regexp` more tightly if you only trust one
workflow path (drop the `(pr|release)` alternation).

## Related files

- `.github/workflows/release.yaml` — tag-driven release workflow; rewrites
  Chart.yaml before `replicated release create`.
- `.github/workflows/pr.yaml` — per-PR customer-grade install (mirrored by
  `make pr-test`).
- `scripts/replicated-slug.sh` — shared branch → channel-slug normalizer.
- `chart/templates/{frontend,backend}/deployment.yaml` — image reference
  resolution logic.
- `chart/values.yaml` — empty `tag:` fields; `repository:` defaults to the
  Replicated proxy registry for KOTS/EC installs.
