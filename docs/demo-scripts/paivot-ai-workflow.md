# paivot-ai Workflow on Groovelab (Demo Script)

**Target length:** 4:00. **Audience:** internal Replicated peers. **Spine:** GRO-7946 (open P0 bug — backend `/api/replicated/license` returns all-nulls; SDK proxy hits wrong path).

## Goal

Show how I build Groovelab using paivot-ai: I tell the orchestrator what's
broken via `/intake`, an unattended loop fixes it, and the result ships to
the Replicated Unstable channel. The whole demo runs forward — no replays,
no staged "live" findings. The bug is real, the fix happens on camera, the
release is real.

The four pillars of paivot-ai land in two beats:

- **Beat 1 — `/intake`:** D&F is real (Sr-PM grounds the story in BUSINESS/DESIGN/ARCHITECTURE) + knowledge compounds (vault context fetched live).
- **Beat 2 — `/piv-loop`:** Durable, compaction-surviving execution.
- **Beat 3 — Product + ship:** Real Replicated app, real release artifact.

## Setup (do before hitting record)

```bash
# Repo + worktree
cd ~/src/github.com/adamancini/groovelab
git status                                  # clean, on main
git pull --ff-only

# Cluster + port-forwards (CMX k3s or local kind)
kubectl -n groovelab get pods               # all Running
kubectl port-forward svc/groovelab-backend 18080:8080 -n groovelab &
kubectl port-forward svc/groovelab-frontend 18443:443 -n groovelab &

# Confirm GRO-7946 is still open and reproducible
nd show GRO-7946 | head -20
curl -s http://localhost:18080/api/replicated/license | jq
# expected: all fields null -- this is the bug we will fix

# Browser tabs primed:
#   1: http://localhost:18443/admin/license   (logged in as admin, broken state visible)
#   2: https://vendor.replicated.com/apps/groovelab/channels   (Unstable channel)
#   3: a fresh terminal-only Claude Code window for beat 2's clean session

# Vault reachable
vlt vault="Claude" read file="groovelab" | head -5

# Terminal: 24x100, mono, dark theme. cwd = repo root.
```

If GRO-7946 has been closed since this script was written, pick the next
open `priority: 0` bug from `nd ls --status=open --priority=0` and adjust
the spine accordingly. The structure does not change.

## Script

### 0:00 – 0:15 — Cold open

Browser → `/admin/license`:

1. License page renders. Every field is `—` or empty. License key area shows
   "License not available."

> "This is the Replicated license page in Groovelab. It's broken — the
> backend SDK proxy is dialing the wrong path on the in-cluster SDK, so
> everything comes back null. I'm going to fix this with paivot-ai in the
> next four minutes. No replays, no edits, just my actual workflow."

Cut to terminal.

### 0:15 – 1:30 — Beat 1: `/intake` — telling the orchestrator what to change

Terminal in the project root, fresh Claude Code session:

```text
/intake
```

The orchestrator says: *"Ready for feedback. Describe each issue — include
screenshots if you have them. Say 'that's all' when done."*

You speak (verbatim — read from this script if needed):

> "The Replicated license page in the Groovelab admin shows all nulls on a
> fresh customer-grade install. The SDK pod itself has the data populated —
> I checked. Looks like the backend SDK proxy is hitting `/api/v1/license`
> when it should hit `/api/v1/license/info`. Fix it. That's all."

Watch on screen:

1. Orchestrator paraphrases back ("So you want the backend SDK proxy to
   call `/api/v1/license/info`, with the response shape matching the SDK's
   contract — confirm?"). You say yes.
2. Orchestrator runs `vlt vault="Claude" read file="groovelab" follow` —
   pulls the project note plus every linked decision/pattern/debug note in
   one call. **Highlight this in editing** — the vault read is the "knowledge
   compounds" pillar.
3. Orchestrator detects the stack (Go backend, React/TS frontend) and maps
   to the relevant skills.
4. Orchestrator delegates to the Sr. PM agent.
5. Sr. PM agent reads `BUSINESS.md`, `DESIGN.md`, `ARCHITECTURE.md`, scans
   `nd ls` for related work, then either:
   - **a.** Detects GRO-7946 as a pre-existing match and links/enriches it
     with the new acceptance criteria from your transcript, or
   - **b.** Files a new story (call it GRO-XXXX) — in which case you close
     it on camera as a duplicate of GRO-7946 with one nd command.

Voiceover during the agent work:

> "I described the bug in plain English. The orchestrator paraphrased it
> back so I could correct it before any work happened. Then it pulled the
> project's vault context — every prior decision and pattern note linked
> from the Groovelab project page — and handed it to the Sr. PM agent
> together with the BUSINESS, DESIGN, and ARCHITECTURE documents. The
> story Sr. PM produces isn't a vibes-based summary of what I said. It's
> grounded in the project's actual D&F outputs."

Show the resulting story:

```bash
nd show GRO-7946
```

Call out (overlay text in editing):
- `related: [GRO-gq31]`
- `DISCOVERED DURING:` line
- The acceptance criteria (numbered list)
- `priority: 0`, `type: bug`

If a duplicate was created, close it now:

```bash
nd close GRO-XXXX --reason="duplicate of GRO-7946; intake re-run for demo"
```

### 1:30 – 3:15 — Beat 2: `/piv-loop` — unattended execution

Cut to a **fresh** Claude Code window. Same project root, same `nd` state,
zero in-context conversation history.

```text
/piv-loop
```

What happens on screen (compress the boring middle in editing — speed-ramp
2-3× during the developer agent's edits, hold real-time on the test pass
output and the PM-Acceptor `accepted` line):

1. Loop reads `nd ls --status=ready` → picks GRO-7946 (deps satisfied).
2. Loop spawns a developer agent in `.worktrees/story-7946`.
3. Developer agent reads the story (no other context loaded), traces the
   SDK proxy code path: `backend/internal/replicated/handler.go`,
   identifies the wrong URL constant, edits it to `/api/v1/license/info`.
4. Developer agent updates the response struct decoder to match the SDK's
   `info` shape.
5. Tests run: backend `replicated` package suite (unit + real-Redis
   integration tests).
6. Story marked `delivered`. Loop spawns PM-Acceptor.
7. PM-Acceptor reviews the recorded proof of passing tests, validates each
   acceptance criterion, accepts. Story closes.
8. Loop reports "no ready work" and exits cleanly.

Voiceover:

> "I started a brand new session. None of the previous conversation is in
> context — the loop knows nothing about what I just did in `/intake`. But
> the `nd` state is on disk, the vault notes are on disk, and the
> dependency graph is on disk. The loop picks the next ready story
> respecting dependencies, dispatches a developer agent into an isolated
> worktree, runs the tests, records proof in the story itself, and hands
> off to a PM-Acceptor. The PM-Acceptor reviews evidence, not vibes. This
> is what 'survives compaction' means in practice — the durable state
> lives outside the conversation."

### 3:15 – 3:45 — Beat 3a: Product moment

Switch to browser tab 1, hard-reload `/admin/license`:

1. License key, customer name, channel name, expiration date, entitlements
   — all populated with real values from the SDK.

> "Same page, same install, no human in the loop after `/intake`. Fixed."

Hold on the populated page for two seconds. Cut.

### 3:45 – 4:00 — Beat 3b: Ship to Unstable

Terminal:

```bash
make release
```

Briefly call out (overlay text): `make release` packages the chart, runs
`replicated release create --yaml-dir release/`, promotes to Unstable. No
git mutations — that's `PUSH=1` mode (separate story, GRO-lxiv).

Switch to browser tab 2 (Vendor Portal Unstable channel). Refresh.

1. New sequence appears at the top with chart artifact `groovelab-X.Y.Z+<sha7>.tgz`.

> "The fix is on the Replicated Unstable channel. Customers on dev licenses
> can install it now. paivot-ai is how I ship a Replicated app."

### 4:00 — Close

> "That was four minutes. The bug was real, the orchestrator routed my
> intent into a properly grounded story, the loop executed it without
> supervision, the PM-Acceptor verified evidence before closing, and the
> chart shipped. paivot-ai is `vlt`, `nd`, `pvg`, and the paivot-graph
> Claude Code plugin — all in one open-source monorepo. Try it.
> Thanks for watching."

## Beats to cut if you run long

- The duplicate-close moment in beat 1 (only matters if Sr. PM creates a
  dupe; if it dedups into GRO-7946, this beat doesn't exist).
- Speed-ramp the developer agent edits down to 4× if beat 2 stretches.
- Drop the `make release` voiceover and just show the Vendor Portal
  refresh — the artifact is self-evident.
- Cold open can shrink to 8 seconds if you trust peers to recognize a
  null-state UI immediately.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| GRO-7946 has been fixed by the time of recording | Pick next P0 open bug; structure is identical. Update spine line at top of script. |
| `/piv-loop` picks a different story than GRO-7946 | Pre-record beat 2 in a worktree where GRO-7946 is the only ready P0; or temporarily mark other ready stories as blocked for the duration of recording. |
| Developer agent fails the test on first take | Two takes. Or narrate "it picked the wrong file, watch it self-correct" — that's also valid demo content. |
| Absolute vault path leaks on screen | Rely on `vlt vault="Claude"` resolution; never `cat` an absolute vault path. |
| `nd` guard blocks an on-camera command | Pre-test every command in this script once before recording. Use `pvg nd` form if running in a worktree-shared vault setup. |
| Demo runs intake while another agent has the vault locked | Confirm no `pvg loop` or background agent is running; check `vlt` lock status before `/intake`. |

## What's NOT in this demo (deliberately)

- Hooks deep dive (PreToolUse scope guard, SessionStart context loading).
- BA / Designer / Architect agents in action — they ran weeks ago. We show
  their *output* (the three D&F docs and the resulting backlog), not the
  process.
- Multi-worktree shared `nd` vault via `git_common_dir`.
- Comparison to other AI dev tools — Q&A territory.

Each is a candidate for a follow-up 2-minute demo if there's appetite.

---

# Addendum — Personal Modifications (Demo Script)

**Target length:** 2:30. **Audience:** same — internal Replicated peers who just watched the main demo. **Recording:** separate take, edited as a continuation.

## Goal

Show that paivot-ai is a fork-friendly system and that adopting it does not
mean accepting upstream's choices. Walk through four concrete changes I made
that I'd recommend any adopter consider. The thesis: this is open-source
plumbing I shape to my workflow, not a SaaS I rent.

## Setup

```bash
cd ~/src/github.com/paivot-ai
git status                    # clean, on main
git remote -v                 # origin = adamancini/paivot-ai (or canonical, depending)
make help                     # show the modified command surface
```

Have two terminal panes ready: one in `~/src/github.com/paivot-ai`, one in
`~/Claude` (the vault checkout). Optional: a second laptop or a screenshot
of one, for the multi-workstation beat.

## Script

### 0:00 – 0:15 — Intro

> "paivot-ai is open source. I run a personal fork because the four
> components — `vlt`, `nd`, `pvg`, and the paivot-graph plugin — all live
> in separate repos and I wanted them to feel like one project. Here are
> the four modifications I made that I'd recommend to anyone adopting
> this."

### 0:15 – 1:00 — Mod A: `make checkpoint` / `make bootstrap`

Terminal in `~/src/github.com/paivot-ai`:

```bash
make help
```

Highlight (overlay text in editing): `checkpoint`, `bootstrap`, `sync`,
`status`, `update`.

Run:

```bash
make status
```

Show the table: `vlt`, `pvg`, `nd`, `paivot-graph` with their ahead/behind
counts vs upstream.

Then:

```bash
make checkpoint
```

Walk through what's happening on screen as it runs:

1. Commits any pending `.vault/issues/` changes (the `nd` backlog).
2. Pushes the meta-repo.
3. Commits and pushes `~/Claude` (the vault is its own git repo synced via
   `git`, **not** any cloud filesystem).
4. Pushes all four component forks to `origin` (my fork).

> "I work across two laptops. Before I switch machines, `make checkpoint`
> commits and pushes the backlog, the vault, and all four component forks
> in dependency order. On the other machine, `make bootstrap` clones
> everything with the right `origin` and `upstream` remotes, then installs
> in dependency order. State follows me; nothing lives only on disk."

### 1:00 – 1:30 — Mod C: Worktree-path guard in shared Claude config

Terminal:

```bash
make check-shared-config
```

Show: `shared Claude config is clean (no .worktrees/ references)`.

> "Parallel Claude Code sessions all read `~/.claude/plugins/*.json`. If
> one session installs the plugin from a `.worktrees/...` path — easy to
> do by accident when you're iterating — that path lands in the shared
> config. Then you remove the worktree, and every other live session
> silently breaks. `make check-shared-config` blocks that. It runs as a
> precondition of `make checkpoint`, so I can't push state with poison
> in it. There's also a `pvg doctor` check for it."

Show:

```bash
pvg doctor 2>&1 | grep -i worktree
```

### 1:30 – 2:00 — Mod B: `PVG_VAULT` configurable vault resolution

> "The vault path used to be hardcoded. I split it out as a closed epic —
> PAI-wna2. Now `PVG_VAULT` resolves three ways: a vault name (looked up
> in Obsidian's `obsidian.json`), an absolute path, or a `~`-relative
> path. My main vault is named `Claude`. When I want to test a change to
> seeded notes without touching live state, I point a sandbox session at
> a throwaway vault."

Terminal:

```bash
echo $PVG_VAULT          # default unset -> resolves the vault named "Claude"
PVG_VAULT=sandbox pvg nd root
PVG_VAULT=/tmp/scratch-vault pvg nd root
```

Show three different resolved paths.

### 2:00 – 2:30 — Mod E: Edit-then-merge seeded vault notes

> "paivot-graph seeds methodology, convention, and concept notes into the
> vault on install. I want to be able to edit those rendered notes
> directly — they're mine — and still pull in upstream improvements. The
> seeder writes a baseline under `<vault>/.seed-baselines/` on every
> reseed. `make reseed` does a 3-way diff3 merge: my edits + upstream
> edits + the baseline. Conflicts get conflict markers, like git."

Terminal:

```bash
ls ~/Claude/.seed-baselines/methodology | head -5
cd ~/src/github.com/paivot-ai/paivot-graph
make reseed                   # safe to run; idempotent, merges only deltas
```

> "This is the difference between treating the vault as configuration —
> read-only, regenerated on every install — and treating it as runtime
> state I own. The vault is mine. The seeds are suggestions."

### 2:30 — Close

> "Four modifications: a unified Makefile so the four forks feel like one
> project, multi-workstation checkpoint and bootstrap, a guard against
> ephemeral worktree paths leaking into shared Claude config, configurable
> vault resolution, and 3-way merge for seeded notes. None of these are
> upstream — yet — but they're in my fork at `adamancini/paivot-ai`. If
> you adopt paivot-ai, these are the customizations I'd recommend you
> start with. Thanks for watching."

## Beats to cut if you run long

- Drop Mod E (the seed merge) — it's the most subtle and the least
  immediately useful for a peer who hasn't seeded a vault yet.
- Drop the `pvg doctor` follow-up under Mod C — `make check-shared-config`
  alone makes the point.
- Trim Mod B to two `PVG_VAULT=` examples instead of three.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `make checkpoint` fails on first run because remotes aren't set | Pre-flight: run `make status` once before recording; resolve any "no upstream" warnings. |
| Vault has uncommitted changes that show up as a noisy diff during checkpoint | Run `git -C ~/Claude status` before recording; commit or stash. |
| `make reseed` produces a conflict marker on camera | This is fine demo content — show resolving one with an editor. Or pre-clean the vault so reseed is a no-op merge. |
| `pvg doctor` output reveals other unrelated warnings | Filter with `grep -i worktree` as scripted, or pre-clear other warnings before recording. |
