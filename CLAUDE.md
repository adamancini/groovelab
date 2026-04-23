# Groovelab — Project Agent Guidance

Read this in full before taking actions in this repo. Overrides any default
behavior where it conflicts.

## Tier Cadence: UAT + Loom Before Moving On

CRITICAL: This bootcamp is structured as tiers (Tier 0 Build It → Tier 1
Automate It → Tier 2 Ship It with Helm → Tier 3 Support It → Tier 4 Ship It on
VM → Tier 5 Config Screen → Tier 6 Deliver It → Tier 7 Operationalize It).

At every tier boundary BEFORE starting the next tier's work:

1. **Pause packaging / Replicated integration work.** Do not begin stories in
   the next tier until the current tier has been through UAT on the local
   deployment.
2. **Run the tier's UAT.** UAT specs live in
   `.vault/knowledge/uat/uat-<EPIC>-tier<N>-*.md` — treat them as the source
   of truth for "what did we ship?".
3. **Produce a 3–5 minute Loom screenplay** for the tier (intro → what's on
   screen → talking points → demo steps → close). Draft scripts live in
   `docs/demo-scripts/tier-<N>.md`. A demo must be recordable in ≤5 minutes —
   if the script exceeds that, cut scope, don't cut pace.
4. Only then resume bootcamp-rubric work in the next tier.

If any tier has shipped without a recorded demo (common when we're ahead of
schedule), backfill the scripts in `docs/demo-scripts/` before starting the
next tier's stories. Catch up UAT before extending the delivery.

**Corollary:** when unparented app-functionality work (bugs, UX polish, missing
music-theory features) is available, prefer those over packaging work until
UAT and demos are caught up. The point of the bootcamp is to practice the
distribution workflow, not to sprint ahead of verification.

## Repo Layout (orientation)

- `frontend/` — Vite + React + TypeScript SPA
- `backend/` — Go chi server, CNPG-backed
- `chart/` — Helm chart (Helm v4, deps: cloudnative-pg, cert-manager, replicated SDK)
- `release/` — KOTS release manifests (Application, HelmChart, Embedded Cluster Config). NOT Kubernetes CRDs — consumed by Replicated only. Do not move these into `chart/templates/`.
- `tests/e2e/` — Tiered e2e shell scripts with Go wrappers (`tier0_test.sh`..`tier4_test.sh`)
- `.vault/` — Obsidian-compatible knowledge vault (issues, UAT, patterns, decisions, debug notes)
- `.vault/issues/` — nd issue tracker files (read via `nd`, never edit directly — hook enforced)
- `FRICTION_LOG.md` — append-only friction log; add entries proactively via the `friction-log` skill

## Non-Negotiables

- **No Bitnami** images or charts — banned. First-party only.
- **Makefile/Taskfile env vars go AFTER the command**, never before (Bash permission prefix matching).
- **Worktrees for all branch work** — `.worktrees/<branch>` under repo root. `.worktrees/` is gitignored.
- **Never mention "Claude" in commits or PRs.**
- **nd issues**: use `nd` CLI commands, never edit `.vault/issues/*.md` directly — a PreToolUse hook will block you.
- **E2e observability**: timestamped step lines, short per-step timeouts, kubectl polling (not `helm install --wait` alone).
- **Friction log proactively**: whenever Replicated/Helm/CMX surprises you or a mis-assumption bites, append to `FRICTION_LOG.md` via the `friction-log` skill.
- **Chart image tags**: never hardcode commit SHAs in `chart/values.yaml`. Leave `image.<side>.tag` empty so `.Chart.AppVersion` is the source of truth; CI rewrites `chart/Chart.yaml` from the git tag before `replicated release create`. See `chart/README.md` for the invariant.
- **Replicated-by-default**: every release + CI install path uses `replicated.enabled=true` (SDK subchart + `proxy.xyyzx.net/proxy/...` image repo + license-scoped `enterprise-pull-secret`). The `replicated.enabled=false` path exists only for local-dev (helmfile-dev profile). Never add it to production or CI install paths without a documented reason. The `.github/workflows/release.yaml` CMX smoke test is the one carved-out exception (unlicensed ephemeral k3s cluster); the customer-grade install path lives in `.github/workflows/pr.yaml`. See `chart/README.md` "Replicated-enabled by default".
- **KOTS release manifests live in `release/`, not `chart/templates/`**: KOTS CRs (`kots.io/v1beta1 Application`, `kots.io/v1beta2 HelmChart`, KOTS `Config`, Embedded Cluster `Config`, etc.) are not Kubernetes CRDs — they are never installed in the target cluster, only read by the Vendor Portal and the KOTS Admin Console. Putting them in `chart/templates/` breaks `helm install` on plain Kubernetes with `resource mapping not found for kind "Application"`. The only KOTS-adjacent files allowed in `chart/templates/` are `kind: Secret` wrappers around troubleshoot.sh Preflight/SupportBundle specs (labeled `troubleshoot.sh/kind`), which ARE real cluster resources. See `chart/README.md` "KOTS manifests live in `release/`".

## Required GitHub Secrets

- `REPLICATED_API_TOKEN` — required for all Replicated CLI calls in `pr.yaml`
  and `release.yaml` (channel/customer/cluster/release create + customer
  archive + channel rm).
- `REPLICATED_ADMIN_TOKEN` — optional. Only consumed by `pr-cleanup.yaml` for
  `replicated release demote`. Add this if the regular API token lacks
  `channel demote` permission; otherwise cleanup falls back to `channel rm`
  alone, which is acceptable for ephemeral per-PR channels.

## Useful References

- UAT specs: `.vault/knowledge/uat/uat-*.md`
- Patterns: `.vault/knowledge/patterns/*.md` (walking skeleton, CNPG service name, helm hyphenated values, etc.)
- Conventions: `.vault/knowledge/conventions/*.md`
- Debug notes: `.vault/knowledge/debug/*.md`
- Design & framing: `BUSINESS.md`, `DESIGN.md`, `ARCHITECTURE.md`
- Demo scripts: `docs/demo-scripts/tier-<N>.md`
