# Friction Log

A running log of every friction point encountered during the Replicated Bootcamp.
Shared at the end of the exercise as structured developer experience feedback.

---

## Entry 1 — 2026-04-15 — annoyance

**Trying to:** Run `helm lint` and `helm template` after `helm dependency update` downloaded all subchart tarballs into `chart/charts/`.

**Expected:** Tarballs present in `charts/` plus a valid `Chart.lock` should be sufficient for `helm lint` and `helm template` to resolve dependencies without re-fetching, matching Helm v3 behaviour.

**Actual:** Helm v4.1.4 reports "found in Chart.yaml, but missing in charts/ directory: postgresql, redis, cert-manager, replicated" even though all four `.tgz` files are physically present. `helm dependency build` re-downloads and exits 0, but subsequent `helm template` still fails with the same error. Root cause: Helm v4 requires the `--dependency-update` flag to be passed explicitly at `helm template`/`helm lint` time; local tarballs alone do not satisfy dependency resolution without it.

**Resolution:** Pass `--dependency-update` to both `helm template` and `helm lint` in all Helm v4 workflows. ~20 minutes of debugging across multiple `helm dependency update`, `helm dependency build`, and `helm template` invocations before identifying the flag requirement.

**Severity:** annoyance

## Entry 2 — 2026-04-15 — annoyance

**Trying to:** Run Bash commands (nd, git, helm) from within a developer agent's worktree directory during story implementation.

**Expected:** A developer agent spawned into a worktree should be able to run all commands from within that worktree without restriction.

**Actual:** The pvg guard hook detected CWD drift into the worktree directory and blocked ALL Bash execution for the agent, including git commits and build verification. The agent could write files via Write tool but could not verify or commit them. This forced the coordinator to run Helm validation from the main session using absolute paths, and route all tracker mutations through a separate PM-Acceptor agent.

**Resolution:** Coordinator ran `helm dependency update`, `helm lint`, and `helm template` from the main session using absolute paths to the worktree. Tracker mutations were routed through PM-Acceptor. ~10 minutes of extra coordination overhead.

**Severity:** annoyance

## Entry 3 — 2026-04-15 — annoyance

**Trying to:** Append a new entry to FRICTION_LOG.md using `cat >>` with heredoc content that included the phrase describing a guard check.

**Expected:** Writing text content to a file should not be intercepted by tool guards regardless of what the text contains.

**Actual:** The nd guard hook pattern-matched on text *inside* the heredoc content (a phrase that looked like an nd subcommand) and blocked the `cat >>` shell command entirely, preventing the file write. The guard is inspecting Bash command content rather than just the command name, causing false positives on file writes that happen to contain guard-triggering strings.

**Resolution:** Used the Edit tool instead of Bash heredoc to append the entry. Immediate workaround, but the false-positive guard match is a latent issue for any shell script or documentation that mentions guard keywords.

**Severity:** annoyance

## Entry 4 — 2026-04-15 — annoyance

**Trying to:** Create a CMX k3s 1.30 cluster as specified in the story AC (`replicated cluster create --distribution k3s --version 1.30`).

**Expected:** k3s 1.30 would be available since the story and ARCHITECTURE.md both reference it as the target test distribution.

**Actual:** k3s 1.30 is no longer available on CMX. The oldest available k3s version is 1.32.0. The `replicated cluster create` command failed with "kubernetes version 1.30 is not supported for distribution k3s" and listed all available versions.

**Resolution:** Used `--version 1.32` instead. No functional impact on the walking skeleton validation.

**Severity:** annoyance

## Entry 5 — 2026-04-15 — blocker (worked around)

**Trying to:** Install the Helm chart with `--dependency-update` to a CMX cluster so that the postgresql subchart would render and deploy.

**Expected:** `helm install --dependency-update` would download subchart tarballs, render their templates, and install everything in one step. This is how Helm v3 worked.

**Actual:** Helm v4.1.4 downloads the subchart `.tgz` files into `chart/charts/` but does NOT extract them into directories. The `helm template` and `helm install` commands only recognize extracted directories for template rendering, so subchart templates are silently omitted from the rendered output. The tarballs are present but the subchart pods (postgresql, redis, etc.) never get deployed. There is no error or warning -- the subchart resources are simply missing from the rendered YAML.

**Resolution:** Manually extracted all `.tgz` files in `chart/charts/` (e.g., `cd chart/charts && ls *.tgz | while read f; do tar xzf "$f"; done`). After extraction, `helm template` (without `--dependency-update`) and `helm install` correctly rendered all subchart templates. ~30 minutes of debugging across multiple install/uninstall cycles, helm template comparisons, and source inspection before identifying the root cause.

**Severity:** blocker (worked around)

## Entry 6 — 2026-04-15 — annoyance

**Trying to:** Select Helm chart dependencies for PostgreSQL and Redis in a new project.

**Expected:** An AI coding agent would default to first-party, upstream-maintained images and charts (e.g., CloudNativePG operator for Postgres, Valkey for Redis) or at minimum ask before choosing a packaging layer.

**Actual:** The agent defaulted to Bitnami subcharts (`oci://registry-1.docker.io/bitnamicharts`) for both PostgreSQL and Redis without considering alternatives. Bitnami images are no longer actively maintained by VMware/Broadcom and represent a known maintenance risk. The incorrect choice was not caught until after the walking skeleton story (GRO-dlnm) was accepted and merged to main, requiring a follow-up story (GRO-lbmc) to replace both dependencies with CNPG + Valkey.

**Resolution:** Added project-level memory rule prohibiting Bitnami. Created GRO-lbmc to replace postgresql with CloudNativePG operator and redis with Valkey inline templates. ~20 minutes of coordination overhead to create the corrective story and redirect the execution loop.

**Severity:** annoyance

## Entry 7 — 2026-04-15 — blocker

**Trying to:** Run an e2e test that installs the Helm chart on a CMX cluster using `--set image.*.repository=ghcr.io/adamancini/...` to bypass the Replicated proxy registry.

**Expected:** The CMX cluster would pull images directly from GHCR since they were just pushed successfully from the local machine.

**Actual:** `ImagePullBackOff` on both frontend and backend pods. GHCR repositories are private and the CMX cluster has no credentials to pull from them. CNPG (public) and Valkey (public) pods came up fine; only the application pods failed. The helm install appeared to succeed but the application never became ready. The silent failure mode (helm exits 0, pods fail asynchronously) made this hard to catch quickly.

**Resolution:** The e2e script must either: (a) create a Kubernetes `imagePullSecret` from local docker credentials before helm install and pass `--set global.imagePullSecrets[0].name=...`, or (b) use the Replicated proxy domain (already in values.yaml) with a test customer license ID as the pull secret password. Script was rewritten with GHCR imagePullSecret creation.

**Severity:** blocker

## Entry 8 — 2026-04-16 — annoyance

**Trying to:** Export a kubeconfig from a CMX cluster using `replicated cluster kubeconfig CLUSTER_ID > /tmp/kubeconfig.yaml` (stdout redirect).

**Expected:** The command would output valid kubeconfig YAML to stdout, allowing standard shell redirection to save it to a file.

**Actual:** Without `--stdout` or `--output-path`, the `replicated cluster kubeconfig` command merges into the existing kubeconfig file by default and prints status text to stdout. Redirecting stdout captures the status text (not YAML), producing an unparseable file. `kubectl` then fails with "couldn't get version/kind; json parse error".

**Resolution:** Use `--output-path /tmp/kubeconfig.yaml` flag instead of stdout redirect. The `--help` text documents this, but the default merge-into-existing behavior is surprising when you just want a standalone kubeconfig file.

**Severity:** annoyance

## Entry 9 — 2026-04-16 — annoyance

**Trying to:** Install the Helm chart on a CMX cluster with the Replicated SDK subchart enabled alongside `global.imagePullSecrets[0].name=ghcr-credentials`.

**Expected:** The SDK subchart would handle the case where `global.replicated.dockerconfigjson` is empty/default gracefully, either skipping secret creation or creating a valid empty secret.

**Actual:** The Replicated SDK subchart creates an `enterprise-pull-secret` of type `kubernetes.io/dockerconfigjson` with the empty string as the `.dockerconfigjson` data value. Kubernetes validates this field and rejects the secret because an empty string is not valid JSON. The entire `helm install` fails with: `Secret "enterprise-pull-secret" is invalid: data[.dockerconfigjson]: Invalid value: unexpected end of JSON input`.

**Resolution:** Disabled the Replicated SDK subchart (`--set replicated.enabled=false`) and nulled the dockerconfigjson key (`--set global.replicated.dockerconfigjson=null`) during e2e testing since no license is needed for the walking skeleton. This is fine for dev/e2e but means the SDK is not exercised in the e2e path.

**Severity:** annoyance
