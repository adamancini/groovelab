# Embedded Cluster Installation Guide

## Overview

The Groovelab Embedded Cluster (EC) installer bundles Kubernetes, KOTS, and all application dependencies into a single binary. This is ideal for bare-metal or VM deployments where you want a self-contained, air-gap-capable installation.

## Prerequisites

- A Linux VM or bare-metal host (minimum 4 vCPU, 8GB RAM, 50GB disk)
- Root or sudo access on the target machine
- A valid Groovelab license file (downloaded from the Replicated Vendor Portal)
- (Optional) For air-gap: the `.airgap` bundle downloaded from the portal

## Installation Steps

### 1. Download the Installer

Visit the [Groovelab Enterprise Portal](https://groovelab.enterprise.replicated.com) and download:
- The Embedded Cluster installer binary for your architecture (`amd64` or `arm64`)
- Your license file (`license.yaml`)
- (Air-gap only) The `.airgap` bundle

### 2. Prepare the License

Transfer your license file to the target machine:

```bash
scp license.yaml root@your-server:/root/
```

### 3. Run the Installer

For online installation:

```bash
chmod +x groovelab-embedded-cluster
sudo ./groovelab-embedded-cluster install \
  --license-file /root/license.yaml \
  --admin-console-port 30000
```

For air-gap installation:

```bash
chmod +x groovelab-embedded-cluster
sudo ./groovelab-embedded-cluster install \
  --license-file /root/license.yaml \
  --airgap-bundle /root/groovelab.airgap \
  --admin-console-port 30000
```

The installer will:
1. Provision a single-node Kubernetes cluster (k3s-based)
2. Install the KOTS Admin Console
3. Deploy the Groovelab application
4. Configure networking and storage

### 4. Access the Admin Console

During installation, you'll be prompted to set an admin console password. Once complete, access the admin console at:

```
https://your-server-ip:30000
```

Log in with the password you set during installation.

### 5. Complete Configuration

In the KOTS Admin Console:
1. Review the preflight checks (all should pass)
2. Configure the application settings:
   - Database configuration (auto-provisioned, but review resource limits)
   - Feature toggles (track export, analytics)
   - TLS certificate (optional — self-signed is pre-configured)
3. Click "Deploy" to start the application

### 6. Access Groovelab

Once deployment is complete, access the application at:

```
https://groovelab.local
```

Or via the port-forward shown in the admin console.

## Verification

### Check Cluster Status

```bash
kubectl get nodes
kubectl get pods -n groovelab
```

### Check Application Health

```bash
kubectl get deployment groovelab-frontend -n groovelab
kubectl get deployment groovelab-backend -n groovelab
```

### View KOTS Admin Console Status

```bash
kubectl get pods -n kotsadm
```

## Air-Gap Deployment

For air-gapped environments (no outbound internet access):

1. Download the `.airgap` bundle from the Enterprise Portal on a connected machine
2. Transfer the bundle, license, and installer binary to the air-gapped host
3. Install with `--airgap-bundle` as shown above
4. The embedded cluster includes all required images and Helm charts

The air-gap network policy will be automatically applied, restricting egress to intra-namespace and DNS traffic only.

## Troubleshooting

### Installer Fails to Start

- Verify the license file is valid and not expired
- Check available disk space (minimum 50GB)
- Ensure no existing Kubernetes installation conflicts

### Application Pods Pending

```bash
kubectl describe pod -n groovelab
```

Common causes:
- Insufficient node resources
- Persistent volume provisioning failure
- Image pull issues (verify air-gap bundle if applicable)

### Admin Console Unreachable

- Verify firewall rules allow port 30000
- Check the kotsadm pods: `kubectl get pods -n kotsadm`
- Review admin console logs: `kubectl logs deployment/kotsadm -n kotsadm`

## Next Steps

- Read the [Upgrade Guide](upgrade.md) for updating the embedded cluster
- Visit the [Enterprise Portal](https://groovelab.enterprise.replicated.com) for support
