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
