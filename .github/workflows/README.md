# GitHub Actions Workflows

## `pr.yaml` — PR Validation

Triggered on every `pull_request` against `main`. Composed of four jobs:

| Job | Runs when | Cost |
|-----|-----------|------|
| `detect-changes` | always | ~5s |
| `lint-test` (Lint and Test) | always | ~2m on cache hit |
| `build-sign` (Build, Push, and Sign Images) | code changed | ~3m |
| `cmx-test` (Replicated Release and CMX Test) | code changed | ~4m |

### Path-filter behavior (GRO-jg8v)

`detect-changes` runs `dorny/paths-filter@v3` and exposes a `code` output. The
filter is **negated**: `code == 'true'` whenever any changed file is **not**
in one of the doc-class paths below. If every change matches a doc-class
path, `code == 'false'` and the heavy jobs skip.

**Doc-class paths (skip Build+Sign and CMX Test):**

- `**/*.md` — any markdown file anywhere in the tree
- `docs/**` — design docs, demo scripts
- `FRICTION_LOG.md` — append-only friction log
- `.vault/knowledge/**` — UAT specs, patterns, decisions, debug notes
- `.gitignore`

`Lint and Test` runs on every PR regardless — it's cheap and catches markdown
lint, link checking, and helm-lint regressions when `chart/README.md` is
edited.

### Why job-level filtering, not workflow-level?

The workflow does **not** use top-level `paths:` / `paths-ignore:`.
Workflow-level filtering prevents the workflow from appearing at all on
filtered PRs, which breaks branch-protection required-status-checks: a
required check that never runs blocks merge. Job-level skip via `if:` reports
as `skipped`, which counts as success for branch protection.

### Verifying

To confirm the gate is working on a PR:

1. **Docs-only commit** (e.g. `FRICTION_LOG.md` only):
   - `Lint and Test` → green
   - `Build, Push, and Sign Images` → skipped
   - `Replicated Release and CMX Test` → skipped
   - PR Validation overall → green

2. **Code commit** (any non-doc-class file):
   - All four jobs run → green

## `release.yaml`

Tag-triggered. Not affected by the path filter.

## `pr-cleanup.yaml`

Runs on PR close. Tears down the per-PR Replicated channel and customer.
