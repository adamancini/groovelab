# BUSINESS.md — Groovelab

## Project Overview

Groovelab is a browser-based music theory learning and practice application focused on bass guitar. It combines flashcard-based theory drilling with an interactive practice track builder, delivering an engaging learning experience inspired by rhythm-game aesthetics (Yousician-style note visualization). The project serves three simultaneous purposes: a personal learning tool for the business owner, a publicly shareable open-source application, and a complete demonstration of the Replicated distribution platform by satisfying the full Replicated Bootcamp rubric (Tiers 0-7).

## Business Goals

1. **Learn bass theory interactively**: Provide a flashcard game that teaches chord types, scales, and note positions across all 12 keys, with adaptive delivery that responds to user performance.
2. **Build practice tracks**: Enable intermediate players to create and play along with practice backing tracks using a built-in synthesized/sampled drum rack and Web Audio API-driven audio.
3. **Complete the Replicated Bootcamp rubric**: Satisfy all eight tiers (0-7) of the bootcamp evaluation, demonstrating mastery of Helm charting, Replicated SDK integration, CI/CD automation, embedded cluster deployment, air-gap installation, support tooling, enterprise portal delivery, and operational security.
4. **Share openly**: Release as a free, open-source project that others can learn from, deploy, and extend.

## Target Users

| Persona | Description | Primary Need |
|---------|-------------|--------------|
| **Beginner bassist** | Learning music theory for the first time | Flashcard-based drilling with adaptive difficulty; start small, expand as mastery grows |
| **Intermediate bassist** | Knows basics, wants structured practice | Create custom practice tracks with backing rhythm; drill specific keys and chord types |
| **Replicated evaluator** | Bootcamp reviewer assessing rubric compliance | All rubric tiers satisfied; clean Helm chart; SDK integration; support bundle; enterprise portal |

Bass guitar is the primary instrument. The conceptual model should be extensible to other instruments in the future, but v1 is bass-only.

## Success Criteria

### Minimum Viable Product (Bootcamp Submission)

| # | Criterion | Measurable Target |
|---|-----------|-------------------|
| SC-1 | Flashcard game functional | User can drill chords/scales across all 12 keys with adaptive card delivery |
| SC-2 | Practice track builder functional | User can create a backing track with built-in drum sounds and play along |
| SC-3 | Bootcamp Tier 0 complete | Custom app, Helm chart, 2+ subcharts, health probes, HTTPS, DB wait, 2+ demoable features |
| SC-4 | Bootcamp Tier 1 complete | CI builds/pushes images, scoped RBAC, PR and release workflows, email on Stable promote |
| SC-5 | Bootcamp Tier 2 complete | SDK subchart (branded), image proxy, custom metrics, license entitlement gate, update banner, license enforcement, optional ingress, configurable service type |
| SC-6 | Bootcamp Tier 3 complete | Preflight checks (DB, endpoint, resources, K8s version, distro), support bundle (per-component logs, health collector, status analyzers, app-specific failure pattern, storage/node checks), bundle upload from app UI |
| SC-7 | Bootcamp Tier 4 complete | EC v3 fresh install, in-place upgrade, air-gap install, correct branding, license-gated configurable feature via KOTS LicenseFieldValue |
| SC-8 | Bootcamp Tier 5 complete | Config screen with 3+ capabilities: external DB toggle, 2+ configurable app features, generated defaults survive upgrade, regex validation, help text on all items |
| SC-9 | Bootcamp Tier 6 complete | Enterprise Portal: branding, custom email sender, CVE review, custom setup docs, chart reference in toc.yaml, Terraform modules, self-serve sign-up, end-to-end install (Helm + EC), upgrade instructions |
| SC-10 | Bootcamp Tier 7 complete | Email/webhook notifications, CVE posture discussion, signed images, air-gap network policy validation (zero outbound) |
| SC-11 | User accounts functional | Local accounts and OAuth (Google, GitHub) working; progress persisted per user |
| SC-12 | Progress tracking operational | Learning progress tracked over time; adaptive flashcard algorithm adjusts card pool based on performance |

### Post-Bootcamp (Iterative Enhancement)

- Additional instrument support beyond bass
- User-uploadable samples for the drum rack
- Richer Yousician-style visual note display (Guitar Hero aesthetic — notes flying across screen in time)
- Community features (shared practice tracks, leaderboards)

## Constraints

### Technical Constraints (Business-Relevant)

| Constraint | Rationale |
|------------|-----------|
| Web browser as primary platform | Maximizes accessibility; no app store dependency |
| Must run in a Kubernetes cluster | Required by Replicated Bootcamp; also the intended production deployment model |
| Web Audio API for all audio | Browser-native synthesis and sample playback; no server-side audio processing |
| Stateful component required | Bootcamp Tier 0 mandates a real stateful component (database) |
| 2+ open-source Helm subcharts | Bootcamp Tier 0; one must provide the stateful component; embedded by default, BYO opt-in |
| All images proxied through custom domain | Bootcamp Tier 2 requirement |
| Air-gap capable | Bootcamp Tier 4 and Tier 7; zero outbound network requests in air-gap mode |

### Timeline Constraints

- **Priority**: Complete the Replicated Bootcamp rubric as quickly as possible.
- **Approach**: Iterative delivery — get the app functional first (Tier 0), then layer on automation (Tier 1), SDK integration (Tier 2), support tooling (Tier 3), and so on through Tier 7.
- Post-rubric features are not time-constrained.

### Budget Constraints

- Free and open-source; no paid dependencies or services required to run.
- No monetization planned.

## Stakeholder Analysis

| Stakeholder | Interest | Influence | Needs |
|-------------|----------|-----------|-------|
| Business Owner (ada) | Primary user and developer; bassist learning theory | High | Working app that teaches bass theory; bootcamp rubric completion |
| Replicated Bootcamp evaluators | Assess rubric compliance | High (gating) | All tiers satisfied with real functionality, not stubs |
| Open-source community | Potential users and contributors | Low (future) | Clean code, good docs, easy deployment |

## Non-Functional Requirements

| NFR | Requirement | Business Rationale |
|-----|-------------|-------------------|
| **Availability** | App must survive pod deletion without data loss | Bootcamp Tier 0 requirement; also basic user expectation |
| **Health observability** | Dedicated `/health` or `/healthz` endpoint; liveness and readiness probes | Bootcamp Tier 0; operational necessity in K8s |
| **Startup resilience** | App waits for database before starting (no crashloop) | Bootcamp Tier 0; user experience on first deploy |
| **HTTPS** | Auto-provisioned cert, manually uploaded cert, and (optional) self-signed cert | Bootcamp Tier 0; security baseline |
| **Update awareness** | Update-available banner visible in app UI | Bootcamp Tier 2; user communication |
| **License enforcement** | App checks license validity via SDK at runtime (active, not passive) | Bootcamp Tier 2; Replicated distribution model |
| **Supportability** | Support bundle generation from app UI; upload to Vendor Portal via SDK | Bootcamp Tier 3; enterprise support workflow |
| **Installability** | Fresh VM install, in-place upgrade, and air-gap install all functional | Bootcamp Tier 4; enterprise deployment scenarios |
| **Configurability** | Config screen with 3+ meaningful capabilities wired to Helm values | Bootcamp Tier 5; enterprise customization |
| **Security** | Signed images; air-gap network policy validated (zero outbound); CVE posture reviewed | Bootcamp Tier 7; enterprise security posture |
| **Audio latency** | Audio playback must feel responsive to user interaction | Core to the practice experience; Web Audio API provides low-latency path |
| **Progress persistence** | User learning data must survive restarts and upgrades | Core value proposition — adaptive learning requires history |

## Content Scope

### Day-One Content

- All 12 musical keys
- Common chord types (major, minor, dominant 7th, major 7th, minor 7th, diminished, augmented — specific set to be confirmed during design)
- Bass guitar fretboard positions
- Built-in drum rack: synthesized and sampled percussion sounds (kick, snare, hi-hat, toms, etc.)

### Deferred Content

- User-uploadable samples
- Additional instruments beyond bass
- Advanced chord voicings and extended harmony

## License Entitlement Model

The Replicated Bootcamp requires license entitlements to gate real product features. The following entitlements are planned:

| Entitlement | What It Gates | Rubric Tier |
|-------------|---------------|-------------|
| Feature gate via SDK runtime query | A real user-facing feature (specific feature TBD during design — e.g., advanced chord types, practice track export, or extended key signatures) | Tier 2 |
| Configurable feature via KOTS LicenseFieldValue | A feature controlled through the KOTS config screen (specific feature TBD during design) | Tier 4 |

The exact features gated by entitlements will be determined during architectural design, but they must be real product features — not artificial toggles.

## Design Inspirations

| Reference | What to Learn From It |
|-----------|----------------------|
| **Yousician** | Guitar Hero-style visualization: notes flying across screen in time with music. Much more complex than v1, but the visual direction to aspire to. |
| **chord.rocks** | Bass chord and scale reference UI; 6-string bass chord diagrams |
| **gitori.com** | Music theory learning interface patterns |

## Authentication Model

- Local user accounts (username/password)
- OAuth providers: Google, GitHub
- Progress tracking is per-user and persisted to the database

## Adaptive Learning Model

- Start with a small set of flashcards
- As the user demonstrates mastery (correct answers), introduce new cards from the broader pool
- Track performance over time to identify weak areas
- The specific algorithm (spaced repetition variant, scoring thresholds) is a design decision, but the business requirement is: adaptive, not random.

## Replicated Bootcamp Rubric Traceability

Every bootcamp tier requirement must be satisfied. The following table maps tiers to business outcomes for traceability during development.

| Tier | Theme | Key Deliverables |
|------|-------|-----------------|
| 0 | Build It | Custom app, Helm chart, 2+ subcharts (1 stateful), health probes, HTTPS, DB wait, 2+ features |
| 1 | Automate It | CI pipeline, scoped RBAC, PR/release workflows, email notifications |
| 2 | Ship It (Helm) | SDK subchart (branded), image proxy, custom metrics, license gate, update banner, license enforcement |
| 3 | Support It | Preflight checks, support bundle (per-component logs, health, status, app-specific failure), bundle upload from UI |
| 4 | Ship It (VM/EC) | Fresh install, upgrade, air-gap, branding, KOTS LicenseFieldValue gate |
| 5 | Config Screen | External DB toggle, 2+ configurable features, generated defaults, regex validation, help text |
| 6 | Deliver It (Portal) | Branding, custom email, CVE review, setup docs, chart ref, Terraform, self-serve, end-to-end install, upgrades |
| 7 | Operationalize It | Notifications, CVE posture, signed images, air-gap network policy (zero outbound) |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope creep from music features delays bootcamp completion | Bootcamp deadline missed | Prioritize rubric tiers first; defer advanced music features to post-bootcamp |
| Audio latency issues in browser across devices | Poor practice experience | Use Web Audio API best practices; test on target browsers early |
| Replicated SDK integration complexity | Delays in Tier 2+ | Follow SDK documentation closely; leverage Replicated CLI tooling and support |
| Air-gap testing complexity | Tier 4/7 delayed | Test air-gap path early; do not leave for last |

## Glossary

| Term | Definition |
|------|-----------|
| **Adaptive flashcard delivery** | Algorithm that adjusts which cards are shown based on user performance history |
| **BYO (Bring Your Own)** | Option for users to provide their own external service (e.g., database) instead of using the bundled one |
| **Drum rack** | Built-in collection of synthesized/sampled percussion sounds for creating backing tracks |
| **Embedded Cluster (EC)** | Replicated's on-prem Kubernetes installer for VM-based deployments |
| **Entitlement** | A license-controlled feature gate; the app checks the Replicated SDK at runtime to determine access |
| **KOTS** | Kubernetes Off-The-Shelf Software; Replicated's admin console for managing app installs |
| **Preflight checks** | Pre-installation validations that verify the target environment meets requirements |
| **Replicated SDK** | Embedded subchart that provides license validation, update checking, metrics reporting, and support bundle capabilities |
| **Support bundle** | Diagnostic archive collected from the running app for troubleshooting |
| **Web Audio API** | Browser-native API for generating and processing audio with low latency |
