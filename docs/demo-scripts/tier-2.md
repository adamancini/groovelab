# Tier 2 — Ship It with Helm (Demo Script)

**Target length:** 5:00. **Epic:** GRO-i3q8. **UAT:** `.vault/knowledge/uat/uat-GRO-i3q8-tier2-ship-it-helm.md`

## Goal

Install Groovelab via Helm from a licensed Replicated customer. Show the SDK,
the image proxy, license enforcement, entitlement gating that toggles live
without a redeploy, and the update banner.

## Setup (do before hitting record)

```bash
# Fresh cluster, fresh namespace:
kubectl create namespace groovelab

# Env (customer with track_export_enabled defined, currently = true):
export REPLICATED_API_TOKEN=...
export REPLICATED_LICENSE_ID=...
export REPLICATED_CUSTOMER_ID=...

# Pre-populated helm values file pointing at Unstable channel. Port-forwards
# not yet started — we will do that live.

# Browser tabs:
#   1: http://localhost:18443/   (empty tab, ready for port-forward)
#   2: Vendor Portal → Customer → Entitlements
#   3: Vendor Portal → Instances for this customer (custom metrics)
```

## Script

### 0:00 – 0:20 — Intro

> "Tier 2 — Ship It with Helm. The app has CI. Now we install it the way an
> enterprise customer would: a licensed Helm install that pulls signed
> images through the Replicated proxy, reports telemetry back, and enforces
> entitlements live."

### 0:20 – 1:00 — Helm install with a license

Terminal:
```bash
helm registry login registry.replicated.com \
  --username $REPLICATED_LICENSE_ID --password $REPLICATED_LICENSE_ID
helm install groovelab oci://registry.replicated.com/groovelab/unstable/groovelab \
  -n groovelab --set replicated.enabled=true
kubectl -n groovelab get pods -w   # until all Running, then Ctrl-C
kubectl -n groovelab get deploy groovelab-sdk   # 1/1
```

> "SDK deployed with the app. Notice the name — `groovelab-sdk`, not
> `replicated-sdk` — that's the `fullnameOverride` branding convention."

### 1:00 – 1:30 — Proxied images

Terminal:
```bash
kubectl -n groovelab get pods -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u
```

> "Every app image starts with `proxy.xyyzx.net/...`. No ghcr.io in the
> pulled image path. Replicated's proxy handles auth with the customer's
> license and rewrites the reference."

### 1:30 – 2:30 — Licensed access + SDK license endpoint

Terminal:
```bash
kubectl -n groovelab port-forward svc/groovelab-backend 18080:8080 &
kubectl -n groovelab port-forward svc/groovelab-frontend 18443:443 &

curl -s localhost:18080/healthz | jq
curl -s localhost:18080/api/replicated/license | jq '{id:.license_id, type:.license_type}'
```

Browser → register a user, log in, hit `/tracks` page — loads.

### 2:30 – 3:30 — Entitlement live-toggle (no redeploy)

Browser → Vendor Portal → set `track_export_enabled = false`. Start a visible
timer on camera.

In the app, create a track, try to export it:
```bash
# Or in the UI — export button should fail with 403
curl -s -b /tmp/cookies.txt -o /dev/null -w '%{http_code}\n' \
  http://localhost:18080/api/v1/tracks/<id>/export
```

> "403 — `entitlement_disabled`. Now flip it back."

Vendor Portal → `track_export_enabled = true`. Wait (≤60s SDK poll), retry
export — 200. No helm upgrade. No pod restart.

### 3:30 – 4:00 — Expired-license blocks the app, not health

Vendor Portal → set the license expiry in the past.
Wait for the next SDK poll.
```bash
curl -s -b /tmp/cookies.txt -o /dev/null -w '%{http_code}\n' \
  http://localhost:18080/api/v1/tracks
# 403 license_expired
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:18080/healthz
# 200 — health is exempt so K8s can still probe it
```

Restore license validity before moving on.

### 4:00 – 4:40 — Update banner

Terminal:
```bash
replicated release create --yaml-dir ./release --promote Unstable --version 2.0.0 --app groovelab
```

> "Second release on the same channel."

Wait or short-circuit by restarting the SDK pod. In the app (admin tab) the
banner appears:
*"A new version of Groovelab is available. [View in Admin]"*

Log in as the non-admin user: banner text differs — *"Contact your administrator."*

### 4:40 – 5:00 — Close

> "Licensed Helm install, proxied images, live entitlement toggle without a
> redeploy, expired-license enforcement that spares health probes, and a
> running-cluster update banner. Tier 3 adds support tooling — preflights
> and support bundles."

## Beats to cut if you run long

- Cut expired-license demo (show the happy path and the entitlement toggle only)
- Cut the non-admin banner variant
