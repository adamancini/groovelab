# Tier 5 E2E Runbook — KOTS Config Screen Verification

Manual procedure for the Tier 5 e2e test (story
[`GRO-hznr`](../../.vault/issues/GRO-hznr.md)). Use this when you cannot or
do not want to run the automated `tests/e2e/tier5_test.sh` (e.g. no CMX VM
budget for a full EC provisioning, or you want to walk through the steps
yourself for the Loom screenplay in `docs/demo-scripts/tier-5.md`).

This runbook covers the same ground as `tier5_test.sh` but is structured for
a human operator with the KOTS Admin Console open in a browser.

## Prerequisites

- A bare Linux VM with internet access (CMX, Proxmox, EC2, whatever).
  Embedded Cluster needs ≥ 2 cores, ≥ 4 GiB RAM, ≥ 40 GiB disk.
- A Replicated customer + license assigned to a temporary channel
  (`replicated channel create --name tier5-runbook`).
- Local `replicated`, `helm`, `ssh`, `scp` installed.

## Procedure

### 1. Cut a release on a temp channel

```bash
# Authenticate
export REPLICATED_API_TOKEN=...
export REPLICATED_APP=groovelab

# Build + push images (or use a recent main-branch tag)
TAG="tier5-runbook-$(date +%s)"
docker buildx build --platform linux/amd64 \
  -t ghcr.io/adamancini/groovelab-frontend:${TAG} --push frontend/
docker buildx build --platform linux/amd64 \
  -t ghcr.io/adamancini/groovelab-backend:${TAG}  --push backend/

# Package chart + create release
helm dependency update chart/
helm package chart/ -d /tmp/ --version 0.1.1
replicated channel create --name "tier5-${TAG}" --app groovelab
replicated release create \
  --app groovelab \
  --yaml-dir release/ \
  --chart "/tmp/groovelab-0.1.1.tgz" \
  --promote "tier5-${TAG}" \
  --version "${TAG}"

# Assign your customer to the channel
replicated customer update \
  --customer "$REPLICATED_CUSTOMER_ID" \
  --app groovelab \
  --channel "tier5-${TAG}"
```

### 2. Install Embedded Cluster on the VM

```bash
# Download installer + license locally
curl -fL -o /tmp/groovelab "https://replicated.app/embedded/groovelab/tier5-${TAG}"
replicated customer download-license \
  --customer "$REPLICATED_CUSTOMER_ID" \
  --app groovelab \
  -o /tmp/license.yaml

# Copy and run on the VM
scp /tmp/groovelab /tmp/license.yaml user@vm:/tmp/
ssh user@vm 'sudo /tmp/groovelab install --license /tmp/license.yaml --no-prompt'
```

Wait for the EC bootstrap to print the Admin Console URL (typically
`http://<vm-ip>:30880`). The first-run flow walks you through:

- Setting an Admin Console password
- Filling in the Config screen (`release/config.yaml`)
- Running preflight checks
- Deploying

For the runbook, accept the defaults on the Config screen except note the
**External DB Password** value -- KOTS auto-fills it with a 24-char random
string. Copy it to your scratchpad; you'll compare it after the upgrade.

### 3. Verify "changes take effect"

For each of the three knobs below, change the value in **Config**, click
**Save**, wait for the deployment to roll, and verify on the running pod.

The `kubectl` invocations use the EC kubeconfig; on the VM run them as
sudo or as a user with read access to that file:

```bash
sudo kubectl --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
  exec deployment/groovelab-backend -n groovelab -- printenv \
  SESSION_DURATION MAX_CARDS_PER_SESSION GUEST_ACCESS_ENABLED
```

| Config item | Set to | Expected env var | Expected value |
|---|---|---|---|
| Max Cards Per Session | `10` | `MAX_CARDS_PER_SESSION` | `10` |
| Session Duration | `1h` | `SESSION_DURATION` | `1h` |
| Enable Guest Access | OFF (unchecked) | `GUEST_ACCESS_ENABLED` | `false` |

Or, scripted via the KOTS CLI on the VM:

```bash
sudo kubectl kots set config --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
  --key max_cards_per_session --value 10 -n groovelab
sudo kubectl kots set config --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
  --key session_duration --value 1h -n groovelab
sudo kubectl kots set config --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
  --key guest_access --value 0 -n groovelab
```

After each change, wait for `kubectl rollout status deployment/groovelab-backend -n groovelab`
to finish, then re-run the `printenv` check.

### 4. Verify regex validation rejects bad input

In the Admin Console **Config** screen, set **Session Duration** to `abc`
and click **Save**. The screen should display the validation error
`Must be a number followed by h (hours) or m (minutes), e.g. 24h or 120m.`
and refuse the save.

CLI-equivalent: `kubectl kots set config --key session_duration --value abc`
exits non-zero with the regex message.

### 5. Verify generated DB password survives upgrade

```bash
# Capture initial value
sudo kubectl kots --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
  get config -n groovelab \
  | yq -r '.spec.values.external_db_password.value' \
  | tee /tmp/dbpw-before.txt
```

Push an upgrade release:

```bash
# Bump chart version, repackage, and create a second release on the same channel
helm package chart/ -d /tmp/ --version 0.1.2
replicated release create \
  --app groovelab \
  --yaml-dir release/ \
  --chart /tmp/groovelab-0.1.2.tgz \
  --promote "tier5-${TAG}" \
  --version "${TAG}-upgrade"
```

Apply the upgrade from the Admin Console **Version History → Deploy**, or
via:

```bash
ssh user@vm '
  sudo kubectl kots upstream upgrade \
    --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
    --deploy -n groovelab
'
```

Wait for the new sequence to deploy, then capture the password again and
diff:

```bash
sudo kubectl kots --kubeconfig=/var/lib/embedded-cluster/k0s/pki/admin.conf \
  get config -n groovelab \
  | yq -r '.spec.values.external_db_password.value' \
  | tee /tmp/dbpw-after.txt

diff /tmp/dbpw-before.txt /tmp/dbpw-after.txt && echo "PASS: password survived upgrade"
```

The two values **MUST** be identical. If they differ, KOTS regenerated the
`{{repl RandomString 24}}` default and the upgrade contract is broken --
file a bug.

While you are at it, re-verify that the operator-set values from §3
(`MAX_CARDS_PER_SESSION=10`, `SESSION_DURATION=1h`, `GUEST_ACCESS_ENABLED=false`)
also survived the upgrade. Same `printenv` invocation as before.

### 6. (Optional) External DB toggle

This step is destructive on the embedded cluster (drops `cnpg.createCluster`)
and requires a reachable external Postgres. Skip unless you have one ready.

In Admin Console **Config**:

1. Switch **Database Type** from `Embedded` to `External PostgreSQL`.
2. Fill in `External DB Host`, `Port`, `Username`, `Password`. Note that
   `Password` already contains the random value from first install -- you
   can replace it with the real password for your external instance.
3. Save and Deploy.

After the rollout, verify:

```bash
# The cnpg Cluster CR should be gone (cnpg.createCluster=false)
sudo kubectl get cluster.postgresql.cnpg.io -n groovelab
# expected: No resources found
```

Backend pods should still come up Ready. The DB_HOST env var on the backend
container is still hard-coded to `groovelab-postgresql-rw` in
`chart/templates/backend/deployment.yaml`, so plain-helm operator overrides
of `externalDatabase.host` do **not** flow through to the backend pod
without further work. KOTS Config -> `optionalValues` only sets
`cnpg.createCluster=false` and the chart values; deeper external-DB
plumbing is tracked separately. See chart/values.yaml for the
`externalDatabase` shape and `chart/templates/_preflight.tpl` which
already uses these values for the troubleshoot.sh preflight check.

### 7. Cleanup

```bash
# Archive channel + release on the vendor side
replicated channel rm "$CHANNEL_ID" --app groovelab

# Tear down the VM (CMX, Proxmox, etc. -- whatever you provisioned with)
```

## Acceptance criteria mapping

| GRO-hznr AC | Covered by |
|---|---|
| EC install verifies config screen visible | §2 (Admin Console first-run) |
| Max Cards Per Session change reflected | §3 row 1 |
| Session Duration "1h" reflected | §3 row 2 |
| Guest Access disabled returns 401 (env reflected) | §3 row 3 |
| Invalid Session Duration "abc" rejected | §4 |
| Generated DB password survives upgrade | §5 |
| External DB toggle | §6 (optional) |

## Why two layers

This story bundles two complementary verifications:

- **Layer 1** (`make chart-test-config-mapping`, runs in CI in seconds):
  catches all the value-mapping regressions that broke
  [GRO-7uiw](../../.vault/issues/GRO-7uiw.md) -- e.g. `| default` in chart
  templates silently restoring defaults when operators set the value to
  `false` / `0`.
- **Layer 2** (`tier5_test.sh` and this runbook): exercises the full path
  through the KOTS Admin Console, KOTS reconciler, Helm rerender, and
  pod env on a real EC install. This is where the upgrade-persistence
  contract for `RandomString` defaults can actually be verified.

Layer 1 alone cannot prove that KOTS persists generated defaults across
upgrades, because that behavior is implemented by `kotsadm` -- not by
chart templating. Layer 2 alone is too expensive to run on every PR. Both
together give us cheap CI coverage of the value-mapping invariants and
expensive-but-real coverage of the runtime KOTS behavior.
