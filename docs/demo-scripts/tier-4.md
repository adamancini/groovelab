# Tier 4 — Ship It on VM (Demo Script)

**Target length:** 5:00. **Epic:** GRO-z5dc. **UAT:** `.vault/knowledge/uat/uat-GRO-z5dc-tier4-ship-it-vm.md`

## Goal

Install Groovelab on a bare VM with no prior Kubernetes, via Embedded
Cluster. Show the KOTS admin console, license-field gate, and an
upgrade-preserves-data run.

## Setup (do before hitting record)

Fresh Ubuntu VM already provisioned (CMX or a local multipass/hetzner box).

```bash
export REPLICATED_API_TOKEN=...
export EC_VM_HOST=user@host
export REPLICATED_LICENSE_ID=...
export REPLICATED_CUSTOMER_ID=...

# Pre-warm: confirm VM is clean
ssh $EC_VM_HOST 'which kubectl || echo no kubectl'   # expect: no kubectl

# Pre-built release on Unstable with EC config. A second "2.0.0" release
# ready in the vendor portal (unpromoted) for the upgrade beat.
```

**If live install is too long for 5 min:** pre-install the VM before
recording. Walk the first-install result. Reserve the install itself for a
longer Loom.

## Script

### 0:00 – 0:20 — Intro

> "Tier 4 — Ship It on VM. Same app, same chart, same SDK — installed on a
> bare Linux box with no Kubernetes. Embedded Cluster handles k0s, the KOTS
> admin console, everything. The operator runs one script."

### 0:20 – 0:50 — Release artifacts

Terminal:
```bash
ls release/
cat release/application.yaml | yq '.spec.title, .spec.statusInformers'
grep -E 'track_export_enabled|optionalValues|recursiveMerge' release/helmchart.yaml
```

> "Three KOTS manifests: the Application, the HelmChart (with
> entitlement gating using `LicenseFieldValue` and `optionalValues`
> recursive-merge), and the Embedded Cluster config."

### 0:50 – 1:10 — `{{repl ...}}` preserved through Helm

Terminal:
```bash
helm template groovelab chart/ --set replicated.enabled=true \
  | grep 'LicenseFieldValue' | head
```

> "The template string is still literal after Helm renders — KOTS will
> evaluate it at install time, not Helm."

### 1:10 – 2:30 — Install on the VM (or walk the pre-install)

If live:
```bash
ssh $EC_VM_HOST 'curl -sSLO <download-portal-url>/groovelab && chmod +x groovelab && sudo ./groovelab install --license /tmp/license.yaml'
```

Show progress lines: k0s bootstrap → images loaded → admin console up.

If pre-installed, just show:
```bash
ssh $EC_VM_HOST 'kubectl --kubeconfig /var/lib/embedded-cluster/k0s/pki/admin.conf get pods -A | head -30'
```

All pods Running.

### 2:30 – 3:15 — KOTS admin console

Terminal:
```bash
ssh -L 30880:localhost:30880 $EC_VM_HOST sleep 300 &
open http://localhost:30880
```

Browser:
1. Groovelab title + icon on the admin home.
2. Version history — one deployed release.
3. Files / Config / Preflight tabs populated.

### 3:15 – 4:00 — License-field gate

Vendor Portal → customer → set `track_export_enabled = false`.
Wait for the cache TTL. Refresh the app, try export → locked.
Flip it back, wait, retry → unlocks. Same UX as Tier 2, but driven by
KOTS's license-field cache rather than the SDK entitlement poll.

### 4:00 – 4:45 — In-place upgrade preserves data

1. Before upgrade: log in, create a track and a flashcard in the app.
2. Vendor Portal: promote the pre-staged `2.0.0` release to the same channel.
3. KOTS admin → Version History → **Deploy** on `2.0.0`.
4. Wait for pods to cycle.
5. ssh back, `kubectl get pods -A | grep -v Running | grep -v Completed`
   → empty.
6. Log in again — the user, track, and flashcard are still there.

### 4:45 – 5:00 — Close

> "One script, bare VM, end-to-end Kubernetes-plus-app, KOTS admin, gated by
> license fields, and an in-place upgrade that kept user data intact. Tier 5
> adds a Config Screen on top of this — operators choose embedded versus
> external Postgres, set session limits, toggle guest access, all from the
> Admin Console. Thanks for watching."

## Beats to cut if you run long

- Skip the artifact tour (0:20–1:10) — voiceover only
- Defer the upgrade beat to a separate Loom (`tier-4-upgrade.md`)
- Drop air-gap — cover in a separate recording

## Pre-recording checklist

- [ ] VM reachable, license file in place
- [ ] Vendor portal customer has `track_export_enabled` defined
- [ ] Second release (`2.0.0`) pre-created, unpromoted
- [ ] SSH tunnel command copy-pasted into history
- [ ] Admin-console credentials handy

## Friction notes (for the voiceover, optional)

- The chart includes a `wait-for-crds` Job because Helm v4 does not
  guarantee CRD installation order across subcharts in a single
  `helm install`. Without the wait-for-crds pattern, `Cluster
  postgresql.cnpg.io/v1` resources fail with "no matches for kind."
  Embedded Cluster inherits this guarantee from the chart.
  ([FRICTION_LOG.md Entry 12](../../FRICTION_LOG.md#entry-12--2026-04-17--blocker-worked-around))
- Helm v4 downloads subchart `.tgz` files but does not extract them.
  `helm template` and `helm install` then silently drop subchart
  resources. Either extract the tarballs or use `--dependency-update`.
  CI handles this; KOTS handles this; a developer running plain
  `helm install` from `chart/` does not. ([Entry 5](../../FRICTION_LOG.md#entry-5--2026-04-15--blocker-worked-around))
