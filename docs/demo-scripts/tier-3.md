# Tier 3 — Support It (Demo Script)

**Target length:** 4:00. **Epic:** GRO-p0ch. **UAT:** `.vault/knowledge/uat/uat-GRO-p0ch-tier3-support-it.md`

## Goal

Show the operator-facing support posture: preflight gates block bad
installs, and a one-click support bundle captures everything a support
engineer would ask for.

## Setup (do before hitting record)

```bash
# Existing Tier 2 install still running
# kubectl preflight plugin installed
# Admin user logged in, on Support tab pre-loaded
# Port-forwards up
kubectl port-forward svc/groovelab-backend 18082:8080 -n groovelab &
```

## Script

### 0:00 – 0:20 — Intro

> "Tier 3 — Support It. Every production install hits problems. Tier 3 makes
> sure those problems are diagnosable without a screen share: preflight
> checks before install, and a support bundle the operator can hand us."

### 0:20 – 1:20 — Preflight on a compliant cluster

Terminal:
```bash
kubectl -n groovelab get secret groovelab-preflight \
  -o jsonpath='{.data.preflight\.yaml}' | base64 -d > /tmp/preflight.yaml
grep -E '1\.28' /tmp/preflight.yaml   # show >= 1.28.0 and < 1.28.0
kubectl preflight /tmp/preflight.yaml --interactive=false
```

> "Five checks: external endpoint reachability, K8s version, cluster CPU,
> cluster memory, and K8s distribution. All pass on this cluster."

Then show the conditional case:
```bash
cd chart && helm dependency update .
helm template groovelab . --set cloudnative-pg.enabled=false | \
  grep -A4 'troubleshoot.sh/kind: preflight' | head -30
```

> "When the customer opts out of the bundled CloudNativePG — because they're
> bringing their own Postgres — the preflight swaps in a `db-connectivity`
> collector. Same chart, conditional check, no manual edits."

### 1:20 – 2:30 — Generate a support bundle (admin UI)

Browser → Admin → **Support**:
1. Click **Generate Bundle** — spinner.
2. After ~1 minute, the bundle appears in **Bundle History**.
3. Click **Download** — a `.tar.gz` lands locally.

Terminal:
```bash
tar tzf ~/Downloads/support-bundle-*.tar.gz | head -20
tar xzf ~/Downloads/support-bundle-*.tar.gz -C /tmp/bundle
find /tmp/bundle -name '*.log' | head
cat /tmp/bundle/health-endpoint/*.json | jq .status
```

> "Frontend logs, backend logs, Postgres, Redis, SDK, and a captured
> `/healthz` response. This is what you'd attach to a Zendesk ticket."

### 2:30 – 3:20 — The bundle is driven by the proxy API

Terminal:
```bash
curl -s -c /tmp/cookies.txt -X POST http://localhost:18082/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<redacted>"}'

curl -s -b /tmp/cookies.txt -X POST http://localhost:18082/api/replicated/support-bundle | tee /tmp/sb.json
BUNDLE_ID=$(jq -r .id /tmp/sb.json)

curl -b /tmp/cookies.txt -o /tmp/b.tar.gz \
  http://localhost:18082/api/replicated/support-bundle/$BUNDLE_ID/download
file /tmp/b.tar.gz
```

> "The UI is a thin skin over the SDK. The backend exposes
> `/api/replicated/support-bundle` so the same flow works in air-gapped
> environments — no external calls."

### 3:20 – 3:45 — Preflight fails closed

(Brief voiceover only — optional live: render against an older cluster)

> "Preflights run before install. If K8s is older than 1.28 or the target
> lacks CPU/memory, the Helm install refuses to proceed. Customers can't
> accidentally silent-fail their way into a broken cluster."

### 3:45 – 4:00 — Close

> "Preflights in, support bundles out, admin-UI one-click, API-driven. Tier
> 4 takes everything you've seen and installs it on a bare VM with no
> Kubernetes at all — Embedded Cluster."

## Beats to cut if you run long

- Drop the conditional preflight rendering (only show the default path)
- Skip the API trace and show only the UI path
