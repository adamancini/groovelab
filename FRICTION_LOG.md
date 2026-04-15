# Friction Log

A running log of every friction point encountered during the Replicated Bootcamp.
Shared at the end of the exercise as structured developer experience feedback.

---

## Entry 1 — 2026-04-15 — annoyance

**Trying to:** Run `helm lint` and `helm template` after `helm dependency update` downloaded all subchart tarballs into `chart/charts/`.

**Expected:** Tarballs present in `charts/` plus a valid `Chart.lock` should be sufficient for `helm lint` and `helm template` to resolve dependencies without re-fetching, matching Helm v3 behaviour.

**Actual:** Helm v4.1.4 reports "found in Chart.yaml, but missing in charts/ directory: postgresql, redis, cert-manager, replicated" even though all four `.tgz` files are physically present. `helm dependency build` re-downloads and exits 0, but subsequent `helm template` still fails with the same error. Root cause: Helm v4 requires the `--dependency-update` flag to be passed explicitly at `helm template`/`helm lint` time; local tarballs alone do not satisfy dependency resolution without it.

**Resolution:** Pass `--dependency-update` to both `helm template` and `helm lint` in all Helm v4 workflows. ~20 minutes of debugging across multiple `helm dependency update`, `helm dependency build`, and `helm template` invocations before identifying the flag requirement.

**Severity:** annoyance
