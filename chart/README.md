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

## Related files

- `.github/workflows/release.yaml` — tag-driven release workflow; rewrites
  Chart.yaml before `replicated release create`.
- `chart/templates/{frontend,backend}/deployment.yaml` — image reference
  resolution logic.
- `chart/values.yaml` — empty `tag:` fields; `repository:` defaults to the
  Replicated proxy registry for KOTS/EC installs.
