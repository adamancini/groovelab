# Helm Installation Guide

## Prerequisites

- A Kubernetes cluster (1.24+) with kubectl configured
- Helm 4.x installed locally
- A valid Groovelab license file (downloaded from the Replicated Vendor Portal)

## Installation Steps

### 1. Authenticate with the Replicated Registry

Log in to the Replicated OCI registry using your license ID:

```bash
export LICENSE_ID="your-license-id-from-portal"
echo "$LICENSE_ID" | helm registry login registry.replicated.com \
  --username "$LICENSE_ID" \
  --password-stdin
```

### 2. Install Prerequisites

The Groovelab chart depends on the CloudNativePG operator for PostgreSQL. Install it first:

```bash
helm upgrade --install cnpg-operator cloudnative-pg \
  --repo https://cloudnative-pg.github.io/charts \
  --version 0.28.2 \
  --namespace cnpg-system \
  --create-namespace \
  --wait
```

### 3. Install Groovelab

Install the Groovelab chart from the Replicated registry:

```bash
helm upgrade --install groovelab \
  oci://registry.replicated.com/groovelab/stable/groovelab \
  --namespace groovelab \
  --create-namespace \
  --wait \
  --timeout 10m
```

The Replicated registry will automatically inject your license-scoped configuration values.

### 4. Verify Installation

Wait for all pods to be ready:

```bash
kubectl wait --for=condition=ready pod \
  --selector app.kubernetes.io/instance=groovelab \
  --namespace groovelab \
  --timeout=300s
```

### 5. Access the Application

Port-forward to access the application locally:

```bash
kubectl port-forward svc/groovelab-frontend 8443:443 \
  --namespace groovelab
```

Open https://localhost:8443 in your browser.

## Post-Installation

### Check Application Status

```bash
kubectl get pods --namespace groovelab
```

You should see pods for:
- `groovelab-frontend` — React SPA served by nginx
- `groovelab-backend` — Go API server
- `groovelab-postgresql` — CloudNativePG PostgreSQL cluster
- `groovelab-valkey` — Valkey cache instance
- `replicated` — Replicated SDK sidecar

### View Logs

```bash
kubectl logs deployment/groovelab-backend --namespace groovelab
kubectl logs deployment/groovelab-frontend --namespace groovelab
```

## Troubleshooting

### ImagePullBackOff

If pods show `ImagePullBackOff`, verify:
1. Helm registry login succeeded (step 1)
2. License file is valid and not expired
3. The `enterprise-pull-secret` was created by the Replicated SDK

### Database Connection Failures

If the backend cannot connect to PostgreSQL:
1. Verify the CNPG operator is running: `kubectl get pods -n cnpg-system`
2. Check the Cluster resource: `kubectl get cluster -n groovelab`
3. Review backend logs for connection details

## License

Your license file can be downloaded from the [Replicated Vendor Portal](https://vendor.replicated.com). Keep it secure — it contains your authentication credentials for the registry and proxy services.

## Next Steps

- Read the [Upgrade Guide](upgrade.md) to keep Groovelab up to date
- Visit the [Enterprise Portal](https://groovelab.enterprise.replicated.com) for support and documentation
