# Tier 1 — Automate It (Demo Script)

**Target length:** 4:30. **Epic:** GRO-jvt8. **UAT:** `.vault/knowledge/uat/uat-GRO-jvt8-tier1-automate-it.md`

## Goal

Show the full CI/CD path: PR → parallel lint+test → matrix-built signed images
→ shared CMX install → Unstable release → gated promotion to Stable. Emphasize
keyless Cosign verification, scoped CI RBAC, and the per-job timing comment that
every PR gets.

## Setup (do before hitting record)

```bash
# Browser tabs pre-loaded:
#   1: https://github.com/adamancini/groovelab/actions
#   2: A pre-staged PR with at least one workflow run complete (do NOT merge yet)
#   3: https://github.com/users/adamancini/packages/container/groovelab-backend
#   4: https://vendor.replicated.com/apps/groovelab/channels
# Terminal:
export REPLICATED_API_TOKEN=<CI service-account token>
# cosign on PATH; docker authenticated to ghcr.io
# Inbox tab open for the Stable-promoted notification email
```

## Script

### 0:00 – 0:20 — Intro

> "Tier 1 is Automate It. Tier 0 built the app. Tier 1 makes every code change
> flow through GitHub Actions — three parallel test jobs, a matrix image
> build, a customer-grade install on a shared CMX cluster, then Unstable-by-
> default with a gated promotion to Stable. The first version of this tier
> shipped without the workflows ever running on origin; we caught it during
> tier review and rebuilt the path you see here."

### 0:20 – 1:10 — PR workflow topology

Browser → pre-staged PR's workflow run. Point at the job graph:

1. **Detect changes** runs first (skips heavy jobs on docs-only PRs).
2. Three test jobs fan out in parallel: **Go test**, **Node test**, **Helm lint**.
3. **Build, Push, and Sign** runs as a matrix: frontend and backend on separate
   runners. The **Collect build-sign outputs** aggregator joins them.
4. **Replicated Release and CMX Test** installs the chart into a per-PR
   namespace on a shared `groovelab-ci` cluster (24h TTL, reused across PRs).
5. **CI Timing Summary** posts a sticky comment on the PR with per-job wall
   times — scroll down on the PR's Conversation tab to show it.

> "Every PR gets the same per-job timing comment. Regressions surface
> immediately the next time the workflow runs."

### 1:10 – 1:50 — Signed images in GHCR

Browser → packages page: show the `pr-<N>-<sha7>` tag on both
`groovelab-frontend` and `groovelab-backend`.

Terminal:
```bash
TAG=pr-5-abc1234   # use the real tag
cosign verify \
  --certificate-identity-regexp='https://github.com/adamancini/groovelab/' \
  --certificate-oidc-issuer='https://token.actions.githubusercontent.com' \
  ghcr.io/adamancini/groovelab-backend:$TAG | jq '.[0].optional.Issuer'
```

> "Keyless Cosign — no long-lived signing key. The signing identity is the
> GitHub Actions OIDC token from this repo. Pulling an image our CI did not
> sign fails verification."

The same `cosign verify` runs inside the `cmx-test` job before `helm install`,
so a tampered image blocks the install.

### 1:50 – 2:30 — RBAC — CI token is scoped

Terminal, with the CI service-account token loaded:

```bash
replicated release ls --app groovelab      # allowed: prints table
replicated channel ls --app groovelab      # allowed
replicated customer create --name "demo-probe" --channel Unstable --app groovelab
#  -> permission error, exits non-zero
```

> "Same token CI uses. It can read and release. It cannot create customers or
> manage licenses. Least-privilege by construction."

### 2:30 – 3:30 — Release to Unstable, gate to Stable

Terminal:
```bash
git tag -a v0.1.0-demo -m "demo"
git push origin --tags
```

Browser → Actions tab: the **Release** workflow starts.

1. Build/Sign matrix runs in parallel.
2. Release-to-Unstable-and-Test installs the new chart on a fresh ephemeral
   k3s cluster (separate from the shared PR cluster — releases get their own).
3. **Promote to Stable** waits in yellow.
4. Click **Review deployments → Approve**.
5. Stable job runs green.

Terminal:
```bash
replicated channel ls --app groovelab
# Unstable + Stable both at v0.1.0-demo
```

### 3:30 – 4:00 — Notification fires

Browser → inbox tab: show the "release promoted to Stable" email from
Replicated. Brief — just prove it arrived.

### 4:00 – 4:15 — Close

> "Three parallel test jobs, a matrix image build, signed pulls, a shared CMX
> cluster that reuses across PRs, scoped CI RBAC, Unstable-by-default with a
> gated Stable promotion, and a timing comment on every PR. Tier 2 installs
> this from a real customer license and wires the SDK for entitlements."

## Beats to cut if you run long

- Drop the inbox check (mention it in the voiceover).
- Skip the Stable promotion live; pre-record it as a separate Loom.
- Cut the cosign-verify terminal beat; rely on the in-CI verification narration.

## Friction notes (for the voiceover, optional)

- Tier 1 was once declared done before any workflow ever ran on the remote.
  Both `pr.yaml` and `release.yaml` were authored locally, committed, and
  approved without GitHub ever exercising them. Tier-review caught it,
  forced a rewrite, and added "at least one green Actions run on origin" to
  the close criteria. ([FRICTION_LOG.md Entry 30](../../FRICTION_LOG.md#entry-30--2026-04-21--annoyance))
- The first push from CI hit `403 Forbidden` on GHCR. Cause: the package
  was originally created by a local `docker push` and had no link to the
  repo. `packages: write` on the workflow token is necessary but not
  sufficient — the package needs to be linked to the repo through the UI
  exactly once. ([Entry 31](../../FRICTION_LOG.md#entry-31--2026-04-21--annoyance))
- The CI service account RBAC policy went through three drafts. The
  cluster-resource prefix is `kots/cluster/...`, not the legacy
  `platform/app/...`; license operations live under `kots/app/[:appId]/license/**`;
  and `kots/app/[:appId]/read` is required or `replicated app ls` returns
  empty. ([Entry 10](../../FRICTION_LOG.md#entry-10--2026-04-17--annoyance))
