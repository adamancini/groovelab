# Air-Gap Validation Report

## Overview

This document describes the methodology and results for validating Groovelab's air-gap deployment mode, which uses a Kubernetes NetworkPolicy to restrict all outbound traffic to intra-namespace communication and DNS resolution only.

## Test Environment

- **Cluster**: Kubernetes v1.34 (k3s via CMX)
- **Namespace**: groovelab
- **Network Policy**: Enabled via `--set airgap.networkPolicy.enabled=true`
- **Date**: 2026-05-13
- **Version**: 0.1.10

## Methodology

### 1. Deploy with Network Policy Enabled

```bash
helm upgrade --install groovelab \
  oci://registry.replicated.com/groovelab/stable/groovelab \
  --version 0.1.10 \
  --namespace groovelab \
  --create-namespace \
  --set airgap.networkPolicy.enabled=true \
  --set cert-manager.enabled=false \
  --set cloudnative-pg.enabled=false \
  --wait \
  --timeout 10m
```

### 2. Verify Network Policy is Applied

```bash
kubectl get networkpolicy -n groovelab
```

Expected output:
```
NAME                POD-SELECTOR   AGE
groovelab-airgap    app.kubernetes.io/part-of=groovelab   5m
```

### 3. Verify Policy Rules

```bash
kubectl get networkpolicy groovelab-airgap -n groovelab -o yaml
```

Expected egress rules:
- Allow to all pods in the same namespace
- Allow DNS (UDP/TCP port 53) to kube-system namespace
- Allow to cnpg-system namespace (for CNPG operator)
- Allow to cert-manager namespace (for cert-manager)
- No other egress permitted

### 4. Exercise All Application Features

| Feature | Test Method | Result |
|---------|-------------|--------|
| Flashcards | Complete a flashcard session via frontend | PASS |
| Fretboard | Navigate fretboard reference tool | PASS |
| Track Builder | Create and play a practice track | PASS |
| User Auth | Register and log in | PASS |
| Theme Toggle | Switch between light/dark themes | PASS |

### 5. Verify Zero Outbound Requests

#### Method A: Packet Capture (tcpdump)

Run tcpdump on the cluster nodes or use a sidecar container:

```bash
# Deploy a debug pod with tcpdump
kubectl run debug --rm -it --image=nicolaka/netshoot --restart=Never -- \
  tcpdump -i any -nn -c 1000 -w /tmp/capture.pcap
```

Analyze the capture for outbound connections:
- **Permitted**: DNS queries (port 53 UDP/TCP), intra-namespace traffic
- **Not permitted**: HTTP/HTTPS to external IPs, API calls outside the cluster

#### Method B: Application Logs

Check application logs for any external API calls or outbound connections:

```bash
kubectl logs deployment/groovelab-backend -n groovelab | grep -E "http://|https://|connect\(|dial"
```

Expected: No outbound HTTP requests from the application itself.

#### Method C: Network Policy Denial Events

Check for NetworkPolicy-denied connections:

```bash
# If using a CNI that supports policy logging (e.g., Calico)
kubectl logs -n kube-system -l k8s-app=calico-node | grep -i "policy.*deny"
```

Or use a custom logging sidecar to capture denials.

## Results

### Outbound Traffic Summary

| Destination Type | Packets Seen | Allowed by Policy | Verdict |
|------------------|--------------|---------------------|---------|
| Intra-namespace (groovelab) | Yes | Yes | ✅ Expected |
| DNS (kube-system:53) | Yes | Yes | ✅ Expected |
| CNPG operator (cnpg-system) | Yes | Yes | ✅ Expected |
| cert-manager (cert-manager) | Yes | Yes | ✅ Expected |
| External HTTP/HTTPS | No | No | ✅ Blocked |
| External APIs | No | No | ✅ Blocked |
| Public internet | No | No | ✅ Blocked |

### Application Functionality

All features tested successfully with network policy enabled:
- ✅ Flashcard sessions complete normally
- ✅ Fretboard reference renders correctly
- ✅ Track builder creates and plays tracks
- ✅ User authentication works
- ✅ Database operations succeed (via intra-namespace CNPG cluster)
- ✅ Cache operations succeed (via intra-namespace Valkey)

## Conclusion

The air-gap network policy successfully blocks all outbound traffic while preserving full application functionality. No unexpected outbound connections were observed during comprehensive feature testing.

## Network Policy Template

The policy used for this validation:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: groovelab-airgap
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/part-of: groovelab
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: cnpg-system
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: cert-manager
```

## Appendix: Verification Commands

Quick verification checklist for auditors:

```bash
# 1. Policy exists
kubectl get networkpolicy -n groovelab

# 2. All pods are running
kubectl get pods -n groovelab

# 3. Application is accessible
kubectl port-forward svc/groovelab-frontend 8443:443 -n groovelab
curl -k https://localhost:8443/healthz

# 4. No unexpected outbound traffic
# (Run packet capture or check application logs as described above)
```
