# Tier 1 — Automate It (Demo Script)

**Target length:** 4:30. **Epic:** GRO-jvt8. **UAT:** `.vault/knowledge/uat/uat-GRO-jvt8-tier1-automate-it.md`

## Goal

Show the full CI/CD path: PR → signed images → Unstable release → gated
promotion to Stable → Replicated email notification. Emphasize Cosign keyless
verification and the scoped CI RBAC token.

## Setup (do before hitting record)

```bash
# Have all three browser tabs pre-loaded:
#   1: https://github.com/adamancini/groovelab/actions
#   2: https://github.com/users/adamancini/packages/container/groovelab-backend
#   3: https://vendor.replicated.com/apps/groovelab/channels
# Terminal ready with:
export REPLICATED_API_TOKEN=<CI service-account token>
# A PR pre-staged that you can comment/rerun, NOT merged yet
# cosign already on PATH; docker authenticated to ghcr.io
# An inbox tab open for the notification email
```

## Script

### 0:00 – 0:20 — Intro

> "Tier 1 is Automate It. In Tier 0 the app existed. In Tier 1 every code
> change now flows through GitHub Actions — lint, test, build, sign, release
> to Unstable, optionally promote to Stable behind an environment approval.
> Here's what that looks like."

### 0:20 – 1:00 — PR workflow

Browser → Actions tab:
1. Show the pre-staged PR's workflow run, three jobs: **Lint and Test**,
   **Build/Push/Sign Images**, **Replicated Release and CMX Test**.
2. All green. Call out run time (8–15 min is typical).
3. Click into the build job — call out the Cosign step.

### 1:00 – 1:45 — Signed images in GHCR

Browser → packages page: show the `pr-<N>-<sha7>` tag on both
`groovelab-frontend` and `groovelab-backend`.

Terminal:
```bash
TAG=pr-5-abc1234   # use your real tag
cosign verify \
  --certificate-identity-regexp='https://github.com/adamancini/groovelab/' \
  --certificate-oidc-issuer='https://token.actions.githubusercontent.com' \
  ghcr.io/adamancini/groovelab-backend:$TAG | jq '.[0].optional.Issuer'
```

> "Keyless Cosign — no long-lived signing key. The identity is the GitHub
> Actions OIDC token from our repo. If anyone ever pulls an image that
> wasn't signed by our CI, this fails."

### 1:45 – 2:30 — RBAC — CI token is scoped

Terminal, with the CI service-account token loaded:
```bash
replicated release ls --app groovelab      # allowed: prints table
replicated channel ls --app groovelab      # allowed
replicated customer create --name "demo-probe" --channel Unstable --app groovelab
#  -> permission error, exits non-zero
```

> "Same token CI uses. It can read, it can release — it cannot create
> customers or manage licenses. Least-privilege by construction."

### 2:30 – 3:30 — Release to Unstable, gate to Stable

Terminal:
```bash
git tag -a v0.1.0-demo -m "demo"
git push origin --tags
```

Browser → Actions tab: the **Release** workflow starts.
1. Show its two jobs: Build/Sign, Release-to-Unstable-and-Test.
2. It finishes; a **Promote to Stable** job is waiting in yellow.
3. Click **Review deployments → Approve**.
4. Stable job runs, goes green.

Terminal:
```bash
replicated channel ls --app groovelab
# Unstable + Stable both at v0.1.0-demo
```

### 3:30 – 4:00 — Notification fires

Browser → inbox tab: show the "release promoted to Stable" email from
Replicated. Brief — just prove it arrived.

### 4:00 – 4:15 — Close

> "PR validation, signed images, scoped CI RBAC, Unstable-by-default with
> a gated Stable promotion, and a notification loop out to the vendor.
> That's Tier 1. In Tier 2 we install this with Helm and wire up the SDK
> for entitlements. Thanks."

## Beats to cut if you run long

- Drop the mailbox check (mention it in the voiceover instead)
- Skip the release-to-stable walkthrough and pre-record it in a separate Loom
