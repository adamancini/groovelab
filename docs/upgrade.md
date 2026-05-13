# Upgrade Guide

## Overview

Groovelab supports two upgrade paths: Helm and Embedded Cluster (KOTS). Follow the path matching your installation method.

## Helm Upgrade Path

### 1. Check Current Version

```bash
helm list --namespace groovelab
```

### 2. Authenticate with Replicated Registry

Ensure you're logged in to the OCI registry:

```bash
export LICENSE_ID="your-license-id"
echo "$LICENSE_ID" | helm registry login registry.replicated.com \
  --username "$LICENSE_ID" \
  --password-stdin
```

### 3. Pull Latest Chart Metadata

```bash
helm show chart oci://registry.replicated.com/groovelab/stable/groovelab
```

### 4. Upgrade Groovelab

```bash
helm upgrade groovelab \
  oci://registry.replicated.com/groovelab/stable/groovelab \
  --namespace groovelab \
  --wait \
  --timeout 10m
```

The upgrade will:
- Rolling-update the frontend and backend deployments
- Apply any schema migrations via init containers
- Update the Replicated SDK if a newer version is available

### 5. Verify the Upgrade

```bash
kubectl get pods --namespace groovelab
kubectl rollout status deployment/groovelab-frontend --namespace groovelab
kubectl rollout status deployment/groovelab-backend --namespace groovelab
```

### 6. Check Application Health

```bash
curl -k https://your-groovelab-host/healthz
curl -k https://your-groovelab-host/livez
```

Both should return HTTP 200.

## Embedded Cluster Upgrade Path

### Via KOTS Admin Console

1. Log in to the KOTS Admin Console at `https://your-server:30000`
2. Navigate to the "Version History" tab
3. The admin console checks for new versions automatically
4. Click "Deploy" next to the desired version
5. Review preflight checks and configuration changes
6. Click "Continue" to apply the upgrade

### Via CLI (Automated)

For automated or CI-driven upgrades:

```bash
# Download the latest KOTS CLI
curl https://kots.io/install | bash

# Log in to the admin console
kubectl kots login --namespace groovelab

# Check available versions
kubectl kots upstream-upgrade --namespace groovelab --dry-run

# Apply the upgrade
kubectl kots upstream-upgrade --namespace groovelab --deploy
```

### Air-Gap Upgrades

For air-gapped environments:

1. Download the new `.airgap` bundle from the Enterprise Portal
2. Transfer it to the air-gapped host
3. In the KOTS Admin Console, click "Upload a new version"
4. Select the `.airgap` bundle file
5. Follow the deployment wizard

## Rollback

### Helm Rollback

If the upgrade fails, roll back to the previous revision:

```bash
helm rollback groovelab --namespace groovelab
```

Or to a specific revision:

```bash
helm history groovelab --namespace groovelab
helm rollback groovelab 2 --namespace groovelab
```

### KOTS Rollback

In the KOTS Admin Console:
1. Go to "Version History"
2. Find the previous working version
3. Click "Rollback" next to that version

## Pre-Upgrade Checklist

- [ ] Backup any critical user data (optional — PostgreSQL persists across upgrades)
- [ ] Review the release notes in the Enterprise Portal
- [ ] Verify current version is healthy (`kubectl get pods`)
- [ ] Ensure license is valid and not near expiration
- [ ] For major version upgrades: review breaking changes in docs

## Post-Upgrade Verification

After any upgrade method:

1. **Pod status**: All pods should be `Running` and `Ready`
2. **Health checks**: `/healthz` and `/livez` return 200
3. **Application functionality**: Test a flashcard session, track builder, and fretboard reference
4. **Database connectivity**: Backend logs show successful PostgreSQL connection
5. **License status**: Replicated SDK reports valid license in admin console

## Troubleshooting

### Upgrade Stuck in Progress

```bash
kubectl get pods --namespace groovelab
kubectl describe pod <stuck-pod> --namespace groovelab
kubectl logs <stuck-pod> --namespace groovelab
```

Common issues:
- **Image pull errors**: Re-authenticate with `helm registry login`
- **Database migration lock**: Check backend init container logs
- **Resource constraints**: Ensure nodes have sufficient CPU/memory

### Version Skipping

Do not skip major versions (e.g., 0.1.x → 0.3.x). Always upgrade through intermediate releases:

```
0.1.8 → 0.1.9 → 0.1.10 → 0.2.0
```

This ensures database migrations and configuration changes apply in the correct order.
