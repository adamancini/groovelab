# Groovelab — Demo Screenplays

Short 3–5 minute Loom scripts for each tier of the bootcamp delivery. Each
script is structured as **Setup → Intro → Demo beats → Close**, with wall-time
budgets per beat so the total stays under 5 minutes.

| Tier | Focus | Script |
|------|-------|--------|
| 0 | Build It — walking skeleton, flashcards, fretboard, admin panel | [tier-0.md](tier-0.md) |
| 1 | Automate It — CI/CD, Cosign, RBAC, Stable gating | [tier-1.md](tier-1.md) |
| 2 | Ship It with Helm — SDK, image proxy, entitlements, update banner | [tier-2.md](tier-2.md) |
| 3 | Support It — preflights, support bundles, admin UI | [tier-3.md](tier-3.md) |
| 4 | Ship It on VM — Embedded Cluster, KOTS admin, in-place upgrade | [tier-4.md](tier-4.md) |

## Recording Conventions

- 1080p, 30fps, system audio + mic
- Browser on the left, terminal on the right (or full-screen + alt-tab)
- Zoom to 125% in browser for legibility
- Have all prerequisites warm before hitting record (port-forwards up, licenses ready,
  terminal cwd set, env vars exported)
- Before recording, do one dry run start-to-finish against the actual running stack
- Cut when the script demands it. Loom auto-trims dead air; still, aim for ≤5 min

## After Recording

- Upload to the shared Loom workspace
- Link the Loom in the tier epic's issue comment (nd update comment)
- Update the UAT note frontmatter: `actionable: pending` → `actionable: demoed`
