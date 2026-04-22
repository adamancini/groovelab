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

## Related files

- `.github/workflows/release.yaml` — tag-driven release workflow; rewrites
  Chart.yaml before `replicated release create`.
- `chart/templates/{frontend,backend}/deployment.yaml` — image reference
  resolution logic.
- `chart/values.yaml` — empty `tag:` fields; `repository:` defaults to the
  Replicated proxy registry for KOTS/EC installs.
