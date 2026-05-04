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

**Trying to:** Deploy the application on a fresh CMX k3s cluster using Helm with CNPG for PostgreSQL.

**Expected:** The backend pod would come up cleanly after migrations ran, since the Helm chart creates both the CNPG cluster credentials and the backend DB credentials.

**Actual:** The backend `db-migrate` init container entered `CrashLoopBackOff` immediately. Root cause: `chart/templates/postgresql/secret.yaml` generated a random password for the CNPG `bootstrap.initdb.secret`, and `chart/templates/backend/secret.yaml` generated a *different* random password for the backend `DATABASE_PASSWORD`. The database was initialized with one password; the backend tried to authenticate with another. Additionally, `postgresql/secret.yaml` lacked a `lookup` guard, so the password would re-randomize on every `helm upgrade`, breaking existing connections.

**Resolution:** Removed `backend/secret.yaml`, updated both the `db-migrate` init container and the main backend container to reference `cnpg-credentials` directly (the same secret CNPG uses), and added a `lookup` guard to `postgresql/secret.yaml` to stabilize the password across upgrades. ~30 minutes diagnosing pod logs versus config, then 10 minutes implementing the fix.

**Severity:** blocker

**Trying to:** Install the Helm chart on a CMX cluster with the Replicated SDK subchart enabled alongside `global.imagePullSecrets[0].name=ghcr-credentials`.

**Expected:** The SDK subchart would handle the case where `global.replicated.dockerconfigjson` is empty/default gracefully, either skipping secret creation or creating a valid empty secret.

**Actual:** The Replicated SDK subchart creates an `enterprise-pull-secret` of type `kubernetes.io/dockerconfigjson` with the empty string as the `.dockerconfigjson` data value. Kubernetes validates this field and rejects the secret because an empty string is not valid JSON. The entire `helm install` fails with: `Secret "enterprise-pull-secret" is invalid: data[.dockerconfigjson]: Invalid value: unexpected end of JSON input`.

**Resolution:** Disabled the Replicated SDK subchart (`--set replicated.enabled=false`) and nulled the dockerconfigjson key (`--set global.replicated.dockerconfigjson=null`) during e2e testing since no license is needed for the walking skeleton. This is fine for dev/e2e but means the SDK is not exercised in the e2e path.

**Severity:** annoyance

## Entry 10 — 2026-04-17 — annoyance

**Trying to:** Configure a Replicated service account token for CI/agent use with minimum-viable RBAC permissions to create releases, manage channels, provision CMX clusters, and create/update customer licenses.

**Expected:** The docs show `[:appId]` as an interpolation variable and `platform/app/[:appId]/cluster/**` as a cluster resource path. Following those patterns should produce a working policy.

**Actual:** Three bugs in the initial policy draft: (1) cluster resources use the prefix `kots/cluster/...`, not `platform/app/[:appId]/cluster/...` — the `platform/` prefix is a legacy alias that does not work for CMX; (2) `platform/app/[:appId]/customer/**` is not a valid resource name — the correct deny target is `kots/app/[:appId]/license/**`; (3) the policy omitted `kots/app/[:appId]/read`, so `replicated app ls` returned an empty list even with a valid token. Additionally, the pre-existing "CI" policy in the Vendor Portal had `allowed: []` / `denied: ["**/*"]` — a fully locked-down placeholder — even though the service account had already been created and a token issued against it.

**Resolution:** Fetched the full RBAC resource name reference from docs.replicated.com, identified the correct `kots/cluster/...` prefix, added `kots/app/[:appId]/read`, and applied the corrected policy via `PUT /vendor/v3/policy/:id` using a personal admin token. The groovelab-ci service account can now list apps, channels, create releases, and manage CMX clusters. ~20 minutes to diagnose, fetch docs, draft corrected policy, and apply via API.

**Severity:** annoyance

## Entry 11 — 2026-04-17 — annoyance

**Trying to:** Push locally-built Docker images to GHCR (ghcr.io/adamancini/groovelab-frontend and groovelab-backend) for a UAT cluster deploy.

**Expected:** The GitHub PAT stored in pass (github.com/adamancini/ghcr_pat) would have sufficient scope to push images, since it was already used successfully for `docker login ghcr.io`.

**Actual:** `docker login` succeeded but `docker push` failed with "permission_denied: The token provided does not match expected scopes." The PAT has only `read:packages` scope, not `write:packages`. Login and pull work; push is silently blocked at push time rather than at login time.

**Resolution:** The active `gh` CLI session already had `write:packages` scope (`gh auth status` confirms). Use `gh auth token | docker login ghcr.io -u adamancini --password-stdin` instead of a stored PAT. No new token needed.

**Severity:** annoyance

## Entry 12 — 2026-04-17 — blocker (worked around)

**Trying to:** Install the groovelab Helm chart on a fresh CMX k3s cluster with `helm install` in a single step.

**Expected:** The CloudNativePG subchart bundles its CRDs, so `helm install` would install CRDs and the CNPG `Cluster` resource in the correct order.

**Actual:** `helm install` failed immediately: "resource mapping not found for name: groovelab-postgresql ... no matches for kind Cluster in version postgresql.cnpg.io/v1 — ensure CRDs are installed first." The CNPG subchart CRDs are not applied before the parent chart's templates that reference them, because Helm does not guarantee CRD installation ordering across subcharts in a single `helm install` invocation.

**Resolution:** Applied CRDs from the CNPG subchart separately before the full install: `helm template groovelab oci://... --show-only 'templates/crds/*' | kubectl apply -f -`, then waited for all CRDs to reach `Established` condition (`kubectl wait --for=condition=Established crd/...`), then ran the full `helm install`. Also required re-applying `app.kubernetes.io/managed-by: Helm` label and both `meta.helm.sh/release-name`/`meta.helm.sh/release-namespace` annotations to all 16 cluster-scoped resources so Helm would adopt them (see Entry 16). Long-term fix is a `wait-for-crds` Job in the chart; see stories GRO-zm5p. ~45 minutes total including annotation surgery.

**Severity:** blocker (worked around)

## Entry 13 — 2026-04-17 — annoyance

**Trying to:** Install the groovelab Helm chart as a customer using `helm registry login` + `helm install oci://registry.xyyzx.net/library/groovelab`, which is the expected Replicated Helm install flow.

**Expected:** After `helm registry login` with the license ID, the chart would be available at the OCI registry URL so a customer could `helm pull` or `helm install` it directly.

**Actual:** `helm show chart oci://registry.xyyzx.net/library/groovelab` returned "unable to locate any tags in provided repository." The release (seq 21) had `helmChartURLs: []` and only showed subcharts (cert-manager, cloudnative-pg, replicated) in its `charts` list. The main groovelab chart was never pushed as an OCI artifact. Root cause: the release was created with `replicated release create --yaml-dir ./chart/`, which uploads chart files as a KOTS manifest bundle, not as a packaged OCI Helm chart. The `.replicated` config's `charts:` block and the no-flag invocation (`replicated release create` reading from `.replicated`) is the correct path for Helm OCI publishing; `--yaml-dir` bypasses it entirely.

**Resolution:** Created a new release using `replicated release create` (no `--yaml-dir`) after fixing `.replicated` to use `appSlug:`. The correct OCI path is NOT `oci://registry.xyyzx.net/library/groovelab` — it includes the app slug and channel slug: `oci://registry.xyyzx.net/<appSlug>/<channelSlug>/<chartName>`. Obtain the exact URL from `replicated customer inspect --customer <id>` (requires admin token; CI service account lacks permission). Login uses the license ID as both username and password: `helm registry login registry.xyyzx.net --username <licenseID> --password <licenseID>`.

**Severity:** annoyance

## Entry 14 — 2026-04-17 — annoyance

**Trying to:** Run `replicated release create` (no flags) using the `.replicated` config file with `app: groovelab` to package and push the Helm chart to the OCI registry.

**Expected:** The CLI would read `app: groovelab`, resolve the app, package the chart, and push it.

**Actual:** Error: `unknown app type ""`. The CLI silently ignored the `app:` key because the config struct uses `yaml:"appSlug"` not `yaml:"app"`. With the slug blank, `resolveAppType()` skipped the API lookup entirely, leaving `appType` as an empty string, which then hits a hard error in `CreateRelease`.

**Resolution:** Changed `app:` to `appSlug:` in `.replicated`. There is no `appType` field in the schema — the CLI determines it by API lookup once the slug is resolved. Identified via source inspection of `pkg/tools/types.go`.

**Severity:** annoyance

## Entry 15 — 2026-04-17 — annoyance

**Trying to:** Promote a Helm-only release (seq 22, packaged via `replicated release create` reading `.replicated`) to the UAT channel, which had one customer with `isKotsInstallEnabled: true`.

**Expected:** The promote would succeed because the customer already had `isHelmInstallEnabled: true` and this was an explicit Helm UAT test. The protective guard blocking KOTS customers from Helm-only releases is reasonable, but the path to fix it should be straightforward via the API.

**Actual:** Promote failed: "You are attempting to promote a helm-cli-only release to a channel with kots-enabled customers." Three attempted fixes all hit unexpected failures before the CLI worked:
1. `PUT /vendor/v3/app/:appId/customer/:customerId` with the CI token — returned RBAC error `access to "kots/app//license/:customerId/update" is denied` (note empty app ID in the resource path — RBAC check was broken for this endpoint with a service account token).
2. `PUT /vendor/v3/customer/:customerId` with the admin token — returned 404. This endpoint exists (it's what the CLI uses) but was returning 404 with no body, which is misleading.
3. `PUT /vendor/v3/customer/:customerId` with proper body — returned 400 "at least one channel must be provided", then 400 "email is required for customers with helm install enabled", before finally discovering the correct required fields via trial and error.

The CLI (`replicated customer update --kots-install=false --channel ... --email ...`) worked after finding all required flags. The API returned 404 for what is a valid endpoint, and the RBAC service account error showed an empty app ID in the resource path, obscuring the true permission issue.

**Resolution:** Used `replicated customer update --app groovelab --customer <id> --name <name> --email <email> --channel <channel> --kots-install=false --helm-install`. ~15 minutes to identify the right command after API 404s and RBAC errors.

**Severity:** annoyance

## Entry 16 — 2026-04-17 — blocker (worked around)

**Trying to:** Install the groovelab Helm chart from the Replicated OCI registry on a fresh CMX cluster where CNPG CRDs are pre-installed (two-phase install workaround for Entry 12).

**Expected:** Pre-annotating or re-annotating cluster-scoped CNPG resources (CRDs, webhooks, RBAC) to point to the `groovelab` release would allow a single `helm install` to proceed without ownership conflicts.

**Actual:** A cascade of Helm ownership annotation failures across multiple resource types — each `helm install` attempt surfaced a new resource type with conflicting or missing ownership metadata. The sequence was: cert-manager CRDs (wrong namespace), CNPG CRDs (wrong release), CNPG MutatingWebhookConfiguration (wrong release), CNPG ClusterRoles (wrong release), then webhook `no endpoints available` (operator pod deleted by uninstall but webhook config remained), then `missing key app.kubernetes.io/managed-by: must be set to Helm` (stripped the label to remove ownership but Helm requires both the label AND annotations). Each fix exposed the next problem. Root causes: (1) CRDs have `helm.sh/resource-policy: keep` preventing deletion on uninstall, leaving them stranded between releases; (2) Helm requires both the `app.kubernetes.io/managed-by: Helm` label AND the release-name/release-namespace annotations to adopt a resource; (3) the CNPG webhook service endpoint disappears when the operator pod is deleted but the webhook config remains, blocking webhook-validated resource creation. The correct long-term fix is a `wait-for-crds` Job in the chart using the pattern from github.com/replicatedhq/platform-examples/tree/main/patterns/multi-chart-orchestration.

**Resolution:** Applied correct label (`app.kubernetes.io/managed-by: Helm`) AND both annotations (`meta.helm.sh/release-name=groovelab`, `meta.helm.sh/release-namespace=groovelab`) to all 16 cluster-scoped CNPG resources. Pre-applied CRDs via `helm template ... --show-only 'templates/crds/*' | kubectl apply -f -`. ~45 minutes across 6+ failed install attempts.

**Severity:** blocker (worked around)

## Entry 17 — 2026-04-17 — blocker

**Trying to:** Pull the frontend image through the Replicated proxy registry (`proxy.xyyzx.net`) after a successful `helm install` with license credentials.
**Expected:** `proxy.xyyzx.net/adamancini/groovelab-frontend:0.1.0` to authenticate using the `enterprise-pull-secret` credentials and serve the image.
**Actual:** Every pull attempt received `400 Bad Request` from `proxy.xyyzx.net/token`. The error body reveals the scope path format is wrong: `"All requested scope names are invalid. Valid scope name must have the following format: proxy/<app-slug>/<full-image-name>"`. The chart values used `proxy.xyyzx.net/adamancini/groovelab-frontend` (missing the required `proxy/<app-slug>/` prefix and the full upstream registry path).
**Resolution:** Changed image repositories in `values.yaml` to `proxy.xyyzx.net/proxy/groovelab/ghcr.io/adamancini/groovelab-frontend` (and backend). The Replicated proxy requires the full upstream registry path embedded in the URL: `proxy.<custom-domain>/proxy/<app-slug>/<upstream-registry>/<org>/<image>`. Confirmed with manual curl to the token endpoint. ~30 minutes.
**Severity:** blocker

## Entry 18 — 2026-04-17 — blocker

**Trying to:** Start the backend after PostgreSQL came up; `wait-for-db` init container was polling for the database.
**Expected:** `groovelab-postgresql` to resolve as a DNS name inside the cluster since the CNPG cluster resource is named `groovelab-postgresql`.
**Actual:** `nc: bad address 'groovelab-postgresql'` — no such service exists. The CloudNativePG operator creates companion Services named `<cluster-name>-rw` (read-write), `<cluster-name>-r` (read), and `<cluster-name>-ro` (read-only), but NOT a plain `<cluster-name>` service.
**Resolution:** Fixed the backend `Deployment` template to use `{{ include "groovelab.fullname" . }}-postgresql-rw` instead of `{{ include "groovelab.fullname" . }}-postgresql`. For immediate UAT, patched the running deployment with `kubectl patch` to update `DB_HOST`. ~20 minutes.
**Severity:** blocker

## Entry 19 — 2026-04-17 — blocker

**Trying to:** Re-run `helm install` after a previous failed install attempt (one of the ownership conflict failures in Entry 16).
**Expected:** Since the previous install failed mid-way, Helm would either have no record of the release or would detect it as failed and allow a clean install.
**Actual:** Helm left a `sh.helm.release.v1.groovelab.v1` Secret in the `groovelab` namespace recording the failed release. Subsequent `helm install` attempts exited with "cannot re-use a name that is still in use." `helm list` showed the release as `failed`. `helm uninstall` then tried to delete resources it owned and cascaded into the CNPG ownership conflict problem (Entry 16), often leaving the cluster in a worse state than before. Even `helm uninstall --keep-history` did not fully clear the state because cluster-scoped resources (CRDs, webhooks) with `keep` policy were left behind with stale ownership metadata.
**Resolution:** Manually deleted the Helm state secrets: `kubectl -n groovelab delete secret sh.helm.release.v1.groovelab.v1`. After removing the secrets, `helm install` treated the release as new. Required in combination with manual CRD/webhook cleanup (Entry 16) to achieve a clean install state. ~10 minutes identifying the secret name and understanding that deleting it was safe.
**Severity:** blocker

## Entry 20 — 2026-04-17 — blocker

**Trying to:** Deploy the current application (with full Chi router, auth, flashcards, fretboard) to the UAT cluster after rebuilding and pushing `0.1.0` Docker images to GHCR.
**Expected:** The running backend pod to serve the new code after `helm upgrade` updated the deployment.
**Actual:** The backend continued returning "Groovelab backend" (the walking skeleton catch-all response from commit `d72fba27`, 2026-04-15). The pod image was `ghcr.io/adamancini/groovelab-backend:0.1.0` but the node had cached the walking-skeleton `0.1.0` image from an earlier install attempt. Because `imagePullPolicy: IfNotPresent`, Kubernetes never pulled the newer push of the same tag. Mutable tags + cached images = silent stale deployment.
**Resolution:** Rebuilt both images using a new tag (`<commit-SHA>` e.g. `3d0c5b2`), pushed, and upgraded with that tag. Forced a fresh pull and confirmed the Chi router was serving `{"error":"not authenticated"}` on `/api/v1/auth/me`. Going forward, CI builds should tag images by git SHA rather than mutable semver tags for release candidates. ~30 minutes diagnosing why the API returned the wrong response.
**Severity:** blocker

## Entry 21 — 2026-04-17 — annoyance

**Trying to:** Run `helm upgrade` after applying a manual `kubectl patch` to a live Deployment to fix `DB_HOST` during UAT debugging.
**Expected:** `helm upgrade` to reconcile the deployment to the desired state from the chart template.
**Actual:** `helm upgrade` with `--server-side-apply` (the Helm v4 default) failed: `Apply failed with 3 conflicts: conflicts with "kubectl-patch"` on `.spec.template.spec.containers[name="backend"].env[name="DB_HOST"].value` and both init containers. The `kubectl patch` created a field manager entry that Helm could not override without explicit permission.
**Resolution:** Added `--force-conflicts` to the `helm upgrade` command to reclaim field ownership. This succeeds but is a one-time override; subsequent upgrades without `--force-conflicts` work normally once Helm owns the fields. Lesson: during UAT debugging, prefer `helm upgrade --set` over `kubectl patch` to stay within Helm's field manager ownership.
**Severity:** annoyance

## Entry 22 — 2026-04-17 — blocker

**Trying to:** Display readable text throughout the Groovelab UI (headings, labels, body copy).
**Expected:** `text-primary` to render as the primary text color (light gray `#e0e0e0` in dark mode).
**Actual:** `text-primary` maps to `--color-primary` which is the BACKGROUND color (`#1a1a2e` in dark mode — near-black). All headings and text using `text-primary` were invisible against the dark background. The design system defined separate tokens: `--color-primary` for backgrounds and `--color-text-primary` for text, generating `bg-primary`/`text-primary` and `text-text-primary` respectively. The comment in `index.css` (`/* Text -- used via text-primary, text-secondary */`) was misleading — it implied `text-primary` was the text utility, when the actual text utility is `text-text-primary`. The mismatch was introduced during the initial component authoring.
**Resolution:** Globally replaced `text-primary` → `text-text-primary` and `text-secondary` → `text-text-secondary` across 19 TSX files, and updated the CSS comment. ~20 minutes identifying root cause, ~5 minutes to fix.
**Severity:** blocker

## Entry 23 — 2026-04-17 — annoyance

**Trying to:** Display topic cards on the Learn page with topic names and card counts.
**Expected:** Each card to show a human-readable topic name (e.g., "Major Chords") and progress info.
**Actual:** Cards showed blank headings and "% accuracy" (rendering `undefined` for missing fields). The frontend `FlashcardTopic` interface was designed with `{id, name, keys_mastered, keys_total, accuracy}` but the backend `TopicSummary` struct serializes as `{topic, card_count, mastery_pct?, practiced_count?}`. TypeScript's structural typing doesn't catch this at runtime — the mis-typed JSON silently deserialized into an object where every accessed field was `undefined`.
**Resolution:** Updated `FlashcardTopic` to match the actual backend wire format. Derived human-readable name from the slug in the component. ~20 minutes to identify root cause via direct `curl` of the API endpoint.
**Severity:** annoyance

## Entry 24 — 2026-04-17 — blocker

**Trying to:** Navigate to a flashcard session page (`/learn/augmented_chords`) and answer questions.
**Expected:** The session page to render a question text and multiple-choice option buttons.
**Actual:** React error #31 ("Objects are not valid as a React child") caused a blank page crash. Root causes: (1) `Flashcard.question` was typed as `string` but the backend returns `question: { prompt, display_name }` — JSX rendered the raw object; (2) `Flashcard.options` was typed as `string[]` but the backend returns `options: 4` (an integer count, not an array). Additionally, `submitAnswer` was sending the selected option label as a plain string; the backend `checkAnswer` compares the `name`/`notes` fields of a JSON object, so string payloads would always produce incorrect comparisons.
**Resolution:** Added an explicit transformation layer at the `api.ts` boundary: raw backend wire types (`RawSessionCard`, `RawAnswerResponse`, etc.) matching the actual JSON shapes, plus `transformSessionCard` / `transformAnswerResponse` that extract question text, build shuffled option-label arrays from `correct_answer` + `distractors`, and produce `_optionAnswers` (label→JSON payload) and `_answerKey` maps. `fetchSession` and `submitAnswer` made `async` to apply transforms before returning. `FlashcardSession.tsx` updated to look up `_optionAnswers[option]` for MC answers and `{ [_answerKey]: value }` for typed answers. Verified with direct `curl` of the answer endpoint (correct JSON object payload → `"correct": true`). ~2 hours total including backend source reading, transform design, and deployment.
**Severity:** blocker

## Entry 25 — 2026-04-20 — blocker

**Trying to:** Retrieve license credentials to authenticate against the Replicated proxy registry (`proxy.xyyzx.net`) for a fresh Helm-only install on a new UAT cluster.
**Expected:** `replicated customer download-license --app groovelab --customer <id>` to return a license file containing the licenseId, which is used as the username/password for `helm registry login` and for constructing the `dockerconfigjson` pull secret.
**Actual:** The command returned `403: {"error":"KOTS installer disabled for customer"}`. The `customer download-license` endpoint is the KOTS-specific license download endpoint and is intentionally blocked for customers on Helm-only channels. There is no obvious CLI command or docs page that explains how to obtain the licenseId for a Helm-only customer.
**Resolution:** Used `replicated customer ls --app groovelab --output json` and parsed the `instances[].licenseId` field from the JSON response to extract the licenseId. Then manually constructed the dockerconfigjson: `{"auths":{"proxy.xyyzx.net":{"auth":"base64(licenseId:licenseId)"}}}` and base64-encoded it for use with `--set global.replicated.dockerconfigjson=`. Also encountered a secondary issue: the Replicated subchart creates an `enterprise-pull-secret` at install time using this value; passing an empty string (the default) produces a Secret with invalid JSON data, causing the install to fail with a Kubernetes validation error rather than a clear "missing credential" message. ~30 minutes total.
**Severity:** blocker

## Entry 26 — 2026-04-20 — blocker

**Trying to:** Write a Helmfile + Taskfile developer workflow that could switch between a local dev install (GHCR images, no license) and a Replicated customer install (proxy registry images, OCI chart). Specifically: determine what credentials and values to pass at `helm install` time for the customer path.
**Expected:** The developer needs to supply `global.replicated.dockerconfigjson` (base64-encoded proxy registry credentials) and `replicated.licenseID` as explicit `--set` flags, because nothing in the chart, the subchart values, or the Replicated docs made it obvious that these would be provided automatically.
**Actual:** When a customer authenticates with `helm registry login registry.replicated.com --username $LICENSE_ID --password $LICENSE_ID` and pulls the OCI chart, Replicated **pre-populates** the chart's `values.yaml` with: `global.replicated.dockerconfigjson` (proxy pull-secret credentials, base64-encoded), `global.replicated.licenseID`, `global.replicated.licenseFields` (with signatures), `global.replicated.channelName`, `global.replicated.customerEmail/Name`, and the full `replicated.*` SDK block (channel ID, sequence, license body, injected app metadata). None of this is mentioned in the SDK installation docs or the Helm values schema reference at the point where a developer is first building the chart. The `replicated.licenseID` and `global.replicated.dockerconfigjson` fields exist in the chart's own `values.yaml` as empty strings, which strongly implies they are developer-supplied — until you actually run `helm show values oci://registry.replicated.com/...` and see them pre-populated.
**Resolution:** Ran `helm registry login` with the dev customer license ID, then `helm show values` on the published OCI chart. Observed the pre-populated values and removed the manual credential construction from the Taskfile. Found the authoritative schema reference at https://docs.replicated.com/vendor/helm-install-values-schema (linked by user after ~30 minutes of manual construction). The Helmfile `replicated` environment was simplified: no `DOCKERCONFIG_B64` env var, no `licenseID` set override — just `helm registry login` before `helmfile sync`.
**Severity:** blocker

## Entry 27 — 2026-04-20 — annoyance

**Trying to:** Deploy the groovelab Helm chart with the CNPG operator pre-installed as a separate helmfile release. Set `cloudnative-pg.enabled: false` in the groovelab release values so the operator subchart doesn't re-deploy.
**Expected:** The `postgresql.cnpg.io/v1 Cluster` resource would still be created — that's a chart-level resource, not part of the operator subchart.
**Actual:** `cluster.yaml` was guarded by `{{- if index .Values "cloudnative-pg" "enabled" }}`, so disabling the subchart also suppressed the Cluster resource. The backend init container looped indefinitely on `nc: bad address 'groovelab-postgresql-rw'` with no obvious error in the helm install output.
**Resolution:** Added a dedicated `cnpg.createCluster: true` flag and changed the cluster.yaml condition to `{{- if .Values.cnpg.createCluster }}`. The `cloudnative-pg.enabled` flag now only controls the subchart deployment. ~15 minutes.
**Severity:** annoyance

## Entry 28 — 2026-04-20 — blocker

**Trying to:** Expose the groovelab app publicly using `replicated cluster port expose` so a colleague could access the UAT install without needing a local port-forward.
**Expected:** `replicated cluster port expose <cluster-id> --port 30080 --protocol http,https` would provision a public DNS entry and TLS cert pointing at the NodePort, as documented at https://docs.replicated.com/reference/replicated-cli-cluster-port-expose.
**Actual:** The command returned `Error: the action is not allowed for the current user or team` on both a k3s (container-based) and an rke2 (VM-based, r1.medium) cluster. The error message gives no indication of what permission is missing, which plan tier enables it, or how to request access. Recreating the cluster on rke2 specifically to satisfy the "VM-based distributions only" requirement in the docs did not help — the error is account-level, not distribution-level.
**Resolution:** Fell back to `cloudflared tunnel --url http://localhost:8080` as a workaround (free tier, no account needed). The tunnel works but is not a first-class Replicated experience. Resolution time: ~20 minutes including cluster recreation.
**Severity:** blocker

## Entry 29 — 2026-04-21 — annoyance

**Trying to:** Run `task image:build-push` to rebuild `groovelab-backend` for linux/amd64 from an Apple Silicon dev host (colima Docker runtime, buildx) as part of pre-UAT image refresh.
**Expected:** buildx would build the Go binary under QEMU emulation and push the amd64 image to GHCR, the same way the frontend build did a few seconds earlier.
**Actual:** The Go 1.25 compiler segfaulted inside QEMU partway through the `github.com/jackc/pgx/v5/pgconn/ctxwatch` package: `/usr/local/go/pkg/tool/linux_amd64/compile: signal: segmentation fault (core dumped)`. The whole `image:build-push` task failed after ~90s. Nothing in the Dockerfile or task docs hinted this would happen — the Dockerfile just did `RUN CGO_ENABLED=0 GOOS=linux go build ...` with no platform pin, so buildx emulated the entire compile under QEMU.
**Resolution:** Pinned the build stage to `FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build` and switched to `GOOS=${TARGETOS} GOARCH=${TARGETARCH}` in the build command. Go's native cross-compiler runs on arm64 and emits an amd64 binary without QEMU in the loop. The final stage still targets amd64. Fix + re-run took ~10 minutes.
**Severity:** annoyance

## Entry 30 — 2026-04-21 — annoyance

**Trying to:** Review Tier 1 (Automate It) work before moving on to Tier 5, per the new "UAT and Loom demo before each tier" rule added to `CLAUDE.md`.
**Expected:** The `pr.yaml` and `release.yaml` workflows in `.github/workflows/` would have been exercised against GitHub Actions at least once during Tier 1, with a visible green run in the Actions tab proving the CI path actually works end to end. That's the natural vendor workflow: push to remote, iterate until green, call it done.
**Actual:** Both workflows were authored by the paivot agent while the repo had no GitHub remote configured. The YAML was committed locally; Tier 1 stories were closed as complete; the remote was added days later (pull request #1 for Renovate shows the first Actions run on the repo, unrelated to Tier 1). The CI was never proven to work before Tier 1 was declared done. This is the kind of thing a real vendor's release engineer would catch immediately because they'd be pushing their own commits and staring at the Actions tab.
**Resolution:** Rewriting the release strategy now, alongside the first push to origin that actually exercises the workflows. Adding new `branch-push.yaml` to handle feature branches → matching channels and `main` → Unstable, keeping `pr.yaml` for per-PR ephemeral channels and `release.yaml` for tag → Stable. Proposed guardrail for agent orchestration: Tier 1 acceptance criteria must include "at least one green GitHub Actions run on origin" before stories can close. Resolution time ~30 minutes to draft the plan; execution in progress.
**Severity:** annoyance

## Entry 31 — 2026-04-21 — annoyance

**Trying to:** Push the branch-per-channel CI workflow to origin and let it run. The first `Branch Push` workflow fired as intended, built the frontend image, then failed at the push step with `403 Forbidden` against `ghcr.io/adamancini/groovelab-frontend`.
**Expected:** GITHUB_TOKEN with `packages: write` permission would be sufficient to push to a container package owned by the same user that owns the repository. It is not.
**Actual:** The package was originally created by a local `docker push` (PAT-based) when images were being built from the dev machine, so `GET /users/adamancini/packages/container/groovelab-frontend` returns `"repository": null`. With no repository link, Actions has no write path to the package regardless of the `packages: write` permission on the workflow token. There is no public REST API to link a user-owned package to a repository — it has to be done once through the UI at `https://github.com/users/<user>/packages/container/<pkg>/settings` → "Manage Actions access" → Add Repository → Write. Once done, subsequent workflow runs succeed.
**Resolution:** Linked both `groovelab-frontend` and `groovelab-backend` packages to `adamancini/groovelab` with Write access via the UI. Re-ran the failed Actions run, got a green build. Resolution took ~10 minutes but only because we'd already built images locally; a first-run vendor would have hit this on the very first CI push with no prior context.
**Severity:** annoyance

## Entry 32 — 2026-04-21 — annoyance

**Trying to:** Bootstrap greenfield Groovelab with modern-ish dependencies so that the bootcamp stays close to what a real customer would start from today.
**Expected:** When an LLM/agent scaffolds a greenfield app in 2026, it picks the current stable major of each library (React 19, TypeScript 5.9+ or 6, ESLint 10, Vite 8, Node 24, Go 1.26, Postgres 18, Redis 8, pgx 5.9.2, etc.). Minor drift over weeks is fine; major drift on day one is not.
**Actual:** Renovate's Dependency Dashboard on the repo shows 26 open PRs immediately after scaffolding, spanning several majors: Node 22→24, Go 1.25→1.26, Postgres 16→18, Redis 7→8, valkey 8→9, ESLint 9→10, Vite 6→8, TypeScript 5.8→6, @vitejs/plugin-react 4→6, eslint-plugin-react-hooks 5→7, eslint-plugin-react-refresh 0.4→0.5, and a pile of GitHub Actions at v3/v4 when v5/v6/v7 are current. The agent's training data bias pushes every default one or two majors behind current. Without Renovate (or dependabot) wired in from day one, we wouldn't have noticed until a CVE or a broken API forced the upgrade.
**Resolution:** Renovate caught it because it was enabled up front. Open PRs will be merged as a background task. For future bootcamps / greenfield scaffolding I want to: (a) run Renovate/dependabot on the first commit so drift is visible immediately, (b) explicitly tell the scaffolding agent "use the latest stable major of every dep, and verify with `npm view <pkg> version` / `gh api repos/<owner>/<repo>/releases/latest`" rather than relying on training defaults, (c) treat a green Renovate dashboard as part of "Tier 0 done."
**Severity:** annoyance

## Entry 33 — 2026-05-01 — blocker

**Trying to:** Pull and install the freshly promoted v0.1.2 release on a UAT cluster using `helm install oci://registry.replicated.com/groovelab/unstable/groovelab` (no `--version` flag), which is what an end-customer's documentation would copy-paste.

**Expected:** With sequence 131 (v0.1.2) promoted to the Unstable channel, an unpinned `helm pull` or `helm install` against the channel's OCI URL would resolve to v0.1.2.

**Actual:** Every unpinned pull returned `v99.99.99` — a stale CMX gate-test release left on the channel from prior CI work. The OCI registry's "latest" resolution uses SemVer precedence (https://semver.org/#spec-item-11), not most-recently-promoted: `99.99.99 > 0.1.2`, so v99.99.99 wins forever. `replicated channel inspect Unstable` mirrored the same display (showed `VERSION: v99.99.99`), reinforcing the misread that the promote had silently failed. It had not — `helm pull oci://... --version 0.1.2` resolved correctly. The semver-max release was the actual head from the perspective of any unpinned client.

**Resolution:** Two action items, both upstream of UAT: (1) test/dev/gate-test releases must use pre-release identifiers (`v0.0.0-test.<sha>`, `v0.1.2-rc.1`, etc.) so they stay below production versions in semver precedence, never above. Plain `v9.9.9` or `v99.99.99` poisons the channel for every subsequent real release. (2) The release.yaml smoke test installs from a local chart tarball rather than `helm install oci://` against the channel, which is why it never noticed the channel head was a fossil. Tier 1 / release-workflow stories should add an end-of-pipeline customer-grade pull as part of the smoke step, exactly so a stuck "latest" tag fails the release rather than UAT. For the immediate v0.1.2 UAT, archive or demote the v99.99.99 release before retrying the unpinned install path.

**Severity:** blocker

## Entry 34 — 2026-05-01 — blocker

**Trying to:** Test the `promote-stable` guard in `release.yaml`, which skips publishing tags that contain `-` or `+` (i.e. SemVer pre-release or build metadata).

**Expected:** A coding agent asked to "tag the repo with a fake version to verify the guard rejects it" would pick a SemVer pre-release qualifier — `v0.0.0-gate-test` or `v0.1.0-rc.1` — that stays below any real release in SemVer precedence and cannot become the channel's "latest" pointer.

**Actual:** The agent picked `v9.9.9-gate-test-dev` and `v99.99.99` — clean SemVer numerals as high as anyone would ever push. The guard worked correctly and blocked promotion to Stable, but the v99.99.99 release landed on the Unstable channel via the workflow's `--promote Unstable` flag. From that moment on, `helm pull oci://registry.replicated.com/groovelab/unstable/groovelab` (no `--version` flag) returns v99.99.99 forever, because OCI registry "latest" resolves by SemVer precedence (https://semver.org/#spec-item-11) and `99.99.99 > anything-real`. We discovered this only at UAT for v0.1.2, when the unpinned customer-grade `helm install` documented in our own demo scripts pulled the fossil instead of the new release.

**Resolution:** Pending. Two parts:
1. Demote v99.99.99 from Unstable via the Vendor Portal UI (admin permission; CI service-account token is denied for `channel demote`).
2. Codify a project rule that test/dev/gate-test tags must use SemVer pre-release identifiers (`v0.0.0-test.<sha>`, `v<real>-rc.<n>`) so they cannot win SemVer-latest resolution. Update `CLAUDE.md` Non-Negotiables and any future "test the guard" prompts to a coding agent. The `pr.yaml` workflow already does the right thing — per-PR versions use `0.0.0-pr${PR_NUMBER}` — so the prevention pattern exists; it just wasn't applied to the manual-tag gate-test flow.

**Severity:** blocker

## Entry 35 — 2026-05-01 — blocker

**Trying to:** After demoting v99.99.99 from the Unstable channel via the Vendor Portal, re-run an unpinned `helm pull oci://registry.replicated.com/groovelab/unstable/groovelab` so the customer-grade install path resolves to v0.1.2.

**Expected:** With v99.99.99 no longer on Unstable (`replicated channel inspect Unstable` confirms `RELEASE: 131`, `VERSION: v0.1.2`), the OCI registry would also drop v99.99.99 from the channel's tag space, and the unpinned pull would resolve to v0.1.2 — the channel head.

**Actual:** Channel-level demotion does not remove the release from the OCI registry's tag space. v99.99.99 is still pullable by `helm pull oci://.../unstable/groovelab` because it exists in the registry as a tagged artifact, and SemVer-max resolution picks across ALL existing tags rather than only channel-active ones. The Vendor Portal's "demote" verb removes a release from a channel's history (so KOTS / Helm upgrade notifications stop seeing it), but does not delete or untag the OCI artifact. To make the unpinned customer install path resolve to the channel head, the polluting release must be either fully archived/deleted from the registry, OR the channel must use distinct OCI repository paths per release (Replicated does not currently expose a per-release OCI URL).

**Resolution:** Pending. For UAT we can pin with `helm pull oci://... --version 0.1.2` and proceed; that is the customer-grade install path with explicit pinning, which is acceptable but suboptimal for documentation copy-paste flows. Permanent fix is upstream: either (a) Replicated deletes the OCI artifact when a release is demoted (preferred), or (b) document clearly that customer install docs must always pin a specific chart version. Treat any future test-version pollution as a forever-cost on the channel's unpinned customer experience.

**Severity:** blocker

## Entry 36 — 2026-05-01 — annoyance

**Trying to:** Run `replicated release lint --yaml-dir release/` locally as a `make release-lint` target so a developer can shake out KOTS CR errors without provisioning anything.

**Expected:** A clean lint pass on `main`, treating any error-severity finding as a real bug.

**Actual:** Permanent error-severity failure on `release/embedded-cluster-config.yaml`: `non-existent-ec-version "Embedded Cluster version not found"` because `spec.version` was checked in as the empty string `""`. This had been the state since the file was first added (commit `e8db886`, GRO-mmab) and never fixed. The tier-5 UAT note in `.vault/knowledge/uat/uat-GRO-7uiw-tier5-config-screen.md` claimed "CI rewrites the EC version at release time -- acceptable", but inspection of `.github/workflows/release.yaml` showed no such rewrite step. CI was simply ignoring the lint error at `release create` time (Vendor Portal accepts an empty EC version as "use latest" or similar). The bogus UAT claim was repeated by an agent in the demo-script friction-notes section, and would have shipped to a Loom narration if a human hadn't questioned it.

**Resolution:** Set `spec.version: 2.17.0+k8s-1.34` directly in `release/embedded-cluster-config.yaml` (the latest published EC release matching the K8s minor used by `pr.yaml` / `release.yaml` cluster create). Added a comment in the file documenting the coupling pattern: the EC version is part of the release artifact, checked in alongside the chart, the helmchart CR, and the application CR; bump it deliberately when the chart is tested against a newer EC release; CI does not rewrite this field. Bumped K8s 1.32 → 1.34 across pr.yaml, release.yaml, EC config, and Makefile in the same change. ~15 minutes including investigation.

Two preventable patterns surfaced:
1. The agent-vs-source-of-truth gap: when an agent finds a comment claiming "CI handles X", verify by reading the workflow before relying on it. The UAT note's claim was unsourced and untested.
2. Release-artifact reproducibility: every field that goes into a release manifest should be either (a) derivable from the git tag, or (b) checked into the repo. Empty fields with implicit "CI fills it in later" semantics fail both criteria — and in this case the "CI fills it in later" was a lie.

**Severity:** annoyance

## Entry 37 — 2026-05-01 — annoyance

**Trying to:** Implement `make release` dev-loop default that produces `<chart-version>+<sha7>` SemVer (build metadata per spec item 10) on every invocation, building + pushing images at the derived version and packaging the chart with `helm package --version` + `--app-version`.

**Expected:** Since SemVer 2.0 explicitly allows `+` in build metadata and Helm v3.8+/v4 OCI clients translate `+` → `_` automatically for OCI tags, the entire pipeline (docker build, image push, helm package, replicated release create) would accept the `+` form transparently.

**Actual:** Helm and Replicated CLI accepted `+` cleanly — `helm package --version 0.1.1+83ff2d0` produced `release/groovelab-0.1.1+83ff2d0.tgz` with helpers preserved, and `replicated release create --version 0.1.1+83ff2d0` produced sequences 133-136 on Unstable with the `+` form intact in chart metadata. **But docker buildx rejected `+` in image tags** with `invalid tag "...:v0.1.1+83ff2d0": invalid reference format`. Per OCI distribution spec, tags match `[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}` — `+` is not in the allowed set. Helm-OCI clients translate this transparently for chart artifacts (so `helm push` and `helm pull --version 0.1.1+sha7` both work), but docker/buildx for plain image tags has no such translation.

**Resolution:** In the Makefile, add a one-line `tr '+' '_'` translation for the image-tag layer ONLY: `REL_VERSION_TAG=$(printf '%s' "$REL_VERSION" | tr '+' '_')`. Pass `$REL_VERSION_TAG` to `docker buildx build --tag` and use `$REL_VERSION` (with `+`) for `helm package --version`, `--app-version`, and `replicated release create --version`. The chart's deployed image-tag wiring (`{{ .Values.image.<side>.tag | default .Chart.AppVersion }}`) needs `app-version` to also use the `_` form so the rendered manifest references a pullable tag. Both forms appear in the same release artifact: `+` in chart metadata, `_` in image references. ~5 minutes once the failure surfaced; the smoke-verify AC anticipated this risk and the fix matched the prediction exactly.

**Severity:** annoyance
